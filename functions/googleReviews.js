/* ==========================================================================
   Crown Head Spa — Google reviews for the public testimonials page.

   Replaces the third-party Elfsight widget, which only allowed one branch
   on the free tier. Reads both branches straight from the Google Places
   API so the page always shows the live rating and review count.

   Two things are cached in Firestore, for different reasons:

     - Place IDs, forever. Resolving a branch name to a Place ID costs a
       Text Search call, and the ID never changes. Google's terms exempt
       place IDs from the caching limit, so this is a once-ever lookup.

     - The reviews themselves, for CACHE_TTL_MS. This keeps the page fast
       and the API bill near zero, and stays far inside the 30-day cap the
       Google Maps Platform terms put on caching place content.

   The API key is a secret (GOOGLE_PLACES_API_KEY) and is only ever read
   here, server-side — it must never reach the public site's JavaScript,
   or anyone could spend the project's quota with it.
   ========================================================================== */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

const googlePlacesApiKey = defineSecret("GOOGLE_PLACES_API_KEY");

const CACHE_COLLECTION = "publicCache";
const REVIEWS_CACHE_DOC = "googleReviews";
const PLACE_IDS_CACHE_DOC = "googlePlaceIds";

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/* Bump to invalidate the cache on the next call: when the shape of a cached
   branch changes, so a deploy that adds or renames a field doesn't serve the
   old shape for up to six hours, or to force a real API round trip after
   changing the key or its restrictions. */
const CACHE_VERSION = 3;

/* The two branches, in the order they should appear on the page. The
   coordinates come from each branch's own Google Maps listing and are only
   used to bias the one-time Place ID lookup toward the right Crown Head
   Spa — there are two, in towns about 20km apart. */
const BRANCHES = [
    {
        key: "binan",
        label: "Biñan",
        searchText: "Crown Head Spa - Binan Laguna",
        latitude: 14.3294943,
        longitude: 121.0888828
    },
    {
        key: "calamba",
        label: "Calamba",
        searchText: "Crown Head Spa - Calamba Laguna",
        latitude: 14.1943873,
        longitude: 121.1645879
    }
];

const DETAILS_FIELD_MASK = [
    "id",
    "displayName",
    "rating",
    "userRatingCount",
    "googleMapsUri",
    "reviews"
].join(",");

/* Google puts the actionable part of a failure (API not enabled, key
   restricted, bad field) in the response body, not the status code, so
   surface it in the log rather than just "HTTP 400". */
async function describeError(response) {
    try {
        const body = await response.json();
        const detail = body && body.error;
        if (detail) {
            return (detail.status || "") + " " + (detail.message || "");
        }
        return JSON.stringify(body).slice(0, 400);
    } catch (err) {
        return "unreadable error body";
    }
}

/* ---------- Place ID resolution (once, then cached forever) ---------- */

async function resolvePlaceId(branch, apiKey) {
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": "places.id,places.displayName"
        },
        body: JSON.stringify({
            textQuery: branch.searchText,
            pageSize: 1,
            locationBias: {
                circle: {
                    center: { latitude: branch.latitude, longitude: branch.longitude },
                    radius: 2000
                }
            }
        })
    });

    if (!response.ok) {
        throw new Error(
            "Places text search failed for " + branch.key + ": HTTP " + response.status +
            " — " + (await describeError(response))
        );
    }

    const body = await response.json();
    const first = Array.isArray(body.places) ? body.places[0] : null;

    if (!first || !first.id) {
        throw new Error("No Google listing found for " + branch.searchText);
    }

    return first.id;
}

async function getPlaceIds(db, apiKey) {
    const ref = db.collection(CACHE_COLLECTION).doc(PLACE_IDS_CACHE_DOC);
    const snapshot = await ref.get();
    const stored = snapshot.exists ? (snapshot.data().placeIds || {}) : {};

    const placeIds = {};
    let discoveredNew = false;

    for (const branch of BRANCHES) {
        if (stored[branch.key]) {
            placeIds[branch.key] = stored[branch.key];
            continue;
        }
        placeIds[branch.key] = await resolvePlaceId(branch, apiKey);
        discoveredNew = true;
    }

    if (discoveredNew) {
        await ref.set({ placeIds, updatedAt: Date.now() }, { merge: true });
    }

    return placeIds;
}

/* ---------- Place details ---------- */

/* Reviews come back sorted by relevance and capped at five per place — the
   Places API offers no way to ask for more, or to sort by date. That is a
   hard ceiling, not a setting we can turn up. The rating and
   userRatingCount below are for the whole listing, though, so the page can
   still show the true totals above those five. */
async function fetchBranchDetails(branch, placeId, apiKey) {
    const response = await fetch(
        "https://places.googleapis.com/v1/places/" + encodeURIComponent(placeId),
        {
            headers: {
                "X-Goog-Api-Key": apiKey,
                "X-Goog-FieldMask": DETAILS_FIELD_MASK
            }
        }
    );

    if (!response.ok) {
        throw new Error(
            "Place details failed for " + branch.key + ": HTTP " + response.status +
            " — " + (await describeError(response))
        );
    }

    const place = await response.json();
    const reviews = Array.isArray(place.reviews) ? place.reviews : [];

    return {
        key: branch.key,
        label: branch.label,
        name: (place.displayName && place.displayName.text) || branch.searchText,
        rating: typeof place.rating === "number" ? place.rating : null,
        reviewCount: typeof place.userRatingCount === "number" ? place.userRatingCount : 0,
        mapsUrl: place.googleMapsUri || null,

        /* Lets the page build a "leave a review" deep link that opens Google's
           review composer for this exact branch. */
        writeReviewUrl: "https://search.google.com/local/writereview?placeid=" +
            encodeURIComponent(placeId),
        reviews: reviews.map(function(review){
            const attribution = review.authorAttribution || {};
            return {
                author: attribution.displayName || "Google user",
                authorPhoto: attribution.photoUri || null,
                authorUrl: attribution.uri || null,
                rating: typeof review.rating === "number" ? review.rating : null,
                text: (review.text && review.text.text) || "",
                relativeTime: review.relativePublishTimeDescription || "",
                publishTime: review.publishTime || null
            };
        }).filter(function(review){
            return review.text.trim().length > 0;
        })
    };
}

/* ---------- getGoogleReviews ---------- */

async function loadReviews(db) {
    const cacheRef = db.collection(CACHE_COLLECTION).doc(REVIEWS_CACHE_DOC);

    const cached = await cacheRef.get();
    if (cached.exists) {
        const data = cached.data();
        if (
            data &&
            data.version === CACHE_VERSION &&
            data.fetchedAt &&
            Date.now() - data.fetchedAt < CACHE_TTL_MS
        ) {
            return { branches: data.branches, cached: true };
        }
    }

    /* Trimmed because the key is pasted into a terminal prompt by hand, and a
       stray space or newline rides along often enough to be worth guarding. */
    const apiKey = (googlePlacesApiKey.value() || "").trim();
    if (!apiKey) {
        throw new HttpsError("failed-precondition", "Google Places API key is not configured.");
    }

    let branches;
    try {
        const placeIds = await getPlaceIds(db, apiKey);
        branches = await Promise.all(BRANCHES.map(function(branch){
            return fetchBranchDetails(branch, placeIds[branch.key], apiKey);
        }));
    } catch (err) {
        console.error("Google reviews fetch failed:", err);

        /* Serving reviews that are a few hours stale beats an empty
           testimonials section, so fall back to whatever is cached even
           once it has aged out. */
        if (cached.exists && cached.data() && cached.data().branches) {
            return { branches: cached.data().branches, cached: true, stale: true };
        }
        throw new HttpsError("unavailable", "Could not load Google reviews right now.");
    }

    await cacheRef.set({ branches, fetchedAt: Date.now(), version: CACHE_VERSION });

    return { branches, cached: false };
}

/* Takes db the same way readAppDataKey does, so this file never has to
   reach for a Firestore handle before index.js has initialized the app. */
function buildGetGoogleReviews(db) {
    return onCall({ secrets: [googlePlacesApiKey] }, function(){
        return loadReviews(db);
    });
}

module.exports = { buildGetGoogleReviews };
