/* ==========================================================================
   CrownOS — Weekly Challenge Score Board (shared)
   Used by Receptionist Sales, Therapist Sales (selected branch) and the
   Admin Dashboard (every branch).

   A week runs Saturday to Friday. A day counts when its branch sales reach
   the branch's Daily Threshold (Branch Settings → Branches), same rule as
   the Monthly Report. Score is "passed of days so far" — a week still in
   progress counts only days up to today.

   When the current week reaches 5, every Active staff member of the branch
   plus all Admin / Executive Assistant accounts are notified once per
   branch per week (crownWeeklyChallengeNotified, synced across devices).

   CrownWeeklyChallenge.mount(el, getBranches) renders one week picker and
   one score board per branch; call .refresh() to re-render (e.g. when the
   selected branch changes).
   ========================================================================== */
(function(){
    const SALES_PREFIX = "crownDailySales_";
    const NOTIFIED_KEY = "crownWeeklyChallengeNotified";
    const TARGET = 5;
    const DEFAULT_THRESHOLD = 15000;
    const DAY_LABELS = ["Sat", "Sun", "Mon", "Tue", "Wed", "Thu", "Fri"];
    const WEEKS_BACK = 26;

    function escapeHtml(value){
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function toDateValue(date){
        return [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0")
        ].join("-");
    }

    function addDays(value, days){
        const date = new Date(value + "T00:00:00");
        date.setDate(date.getDate() + days);
        return toDateValue(date);
    }

    /* Saturday on or before the given date value. */
    function getWeekStart(value){
        const date = new Date(value + "T00:00:00");
        return addDays(value, -((date.getDay() + 1) % 7));
    }

    function shortDate(value){
        return new Date(value + "T00:00:00").toLocaleDateString(
            "en-PH",
            { month: "short", day: "numeric" }
        );
    }

    function getThreshold(branch){
        try{
            const list = JSON.parse(localStorage.getItem("crownBranchMasterList") || "[]");
            const match = Array.isArray(list) && list.find(function(item){
                return item && item.name === branch;
            });
            const value = match ? Number(match.incomeThreshold) : 0;

            return value > 0 ? value : DEFAULT_THRESHOLD;
        }catch(error){
            return DEFAULT_THRESHOLD;
        }
    }

    /* Settled sales for the branch on that date — same cost rule as the
       Receptionist Sales Total Sales (freebies count at their value). */
    function getDaySales(branch, date){
        try{
            const parsed = JSON.parse(
                localStorage.getItem(SALES_PREFIX + branch + "_" + date) || "null"
            );

            return (Array.isArray(parsed?.rows) ? parsed.rows : [])
                .filter(function(sale){ return sale.settled !== false; })
                .reduce(function(total, sale){
                    return total + (Array.isArray(sale?.services) ? sale.services : [])
                        .reduce(function(sum, item){
                            return sum + (
                                item?.isFreebie
                                    ? (Number(item?.freebieValue) || 0)
                                    : (Number(item?.amount) || 0)
                            );
                        }, 0);
                }, 0);
        }catch(error){
            return 0;
        }
    }

    function getScore(branch, weekStart){
        const today = toDateValue(new Date());
        const threshold = getThreshold(branch);
        const days = [];
        let passed = 0;
        let counted = 0;

        DAY_LABELS.forEach(function(label, index){
            const date = addDays(weekStart, index);
            let hit = false;

            if(date <= today){
                counted++;
                hit = getDaySales(branch, date) >= threshold;

                if(hit){
                    passed++;
                }
            }

            days.push({ label: label, date: date, hit: hit });
        });

        return { threshold: threshold, passed: passed, counted: counted, days: days };
    }

    function notifyAchieved(branch, weekStart){
        const marker = branch + "|" + weekStart;
        let notified = {};

        try{
            notified = JSON.parse(localStorage.getItem(NOTIFIED_KEY) || "{}") || {};
        }catch(error){
            notified = {};
        }

        if(notified[marker]){
            return;
        }

        const recipients = (window.CrownAuth?.getUsers?.() || [])
            .filter(function(user){
                if(!user || user.status !== "Active" || !user.account){
                    return false;
                }

                const roles = [user.role, user.secondaryRole];

                return (
                    roles.includes("Admin") ||
                    roles.includes("Executive Assistant") ||
                    (Array.isArray(user.branches) && user.branches.includes(branch))
                );
            })
            .map(function(user){ return user.account; });

        if(recipients.length === 0 || !window.CrownClientNotifications?.broadcast){
            return;
        }

        notified[marker] = new Date().toISOString();
        localStorage.setItem(NOTIFIED_KEY, JSON.stringify(notified));

        window.CrownClientNotifications.broadcast(
            recipients,
            "Congratulations, You've accomplished the weekly Challenge. (" + branch + ")",
            "weekly-challenge"
        );
    }

    function mount(el, getBranches){
        if(!el){
            return { refresh: function(){} };
        }

        const currentStart = getWeekStart(toDateValue(new Date()));
        let selectedWeek = currentStart;

        function weekOptions(){
            let html = "";

            for(let i = 0; i < WEEKS_BACK; i++){
                const start = addDays(currentStart, -7 * i);
                const end = new Date(addDays(start, 6) + "T00:00:00").toLocaleDateString(
                    "en-PH",
                    { month: "short", day: "numeric", year: "numeric" }
                );

                html += `<option value="${start}"${start === selectedWeek ? " selected" : ""}>` +
                    `${escapeHtml(shortDate(start))} – ${escapeHtml(end)}${i === 0 ? " (This week)" : ""}</option>`;
            }

            return html;
        }

        function render(){
            const branches = (typeof getBranches === "function" ? getBranches() : [])
                .filter(Boolean);

            const boards = branches.map(function(branch){
                const score = getScore(branch, selectedWeek);

                if(score.passed >= TARGET && selectedWeek === currentStart){
                    notifyAchieved(branch, selectedWeek);
                }

                return `
                    <div class="wc-board">
                        ${branches.length > 1 ? `<div class="wc-branch">${escapeHtml(branch)}</div>` : ""}
                        <div class="wc-meta">
                            <span>Daily Threshold:</span>
                            <strong>₱${score.threshold.toLocaleString("en-PH")}</strong>
                            <span>Score:</span>
                            <strong>${score.passed} of ${score.counted}</strong>
                        </div>
                        <div class="wc-days">
                            ${score.days.map(function(day){
                                return `<div class="${day.hit ? "passed" : ""}" title="${escapeHtml(shortDate(day.date))}">${day.label}</div>`;
                            }).join("")}
                        </div>
                    </div>
                `;
            }).join("");

            el.innerHTML = `
                <div class="wc-panel">
                    <div class="wc-heading">
                        <div>
                            <p class="wc-eyebrow">Saturday to Friday</p>
                            <h3>Weekly Challenge Score Board</h3>
                        </div>
                        <select class="form-select form-select-sm wc-select" aria-label="Select week">
                            ${weekOptions()}
                        </select>
                    </div>
                    ${boards || '<div class="wc-empty">No branch selected.</div>'}
                </div>
            `;

            el.querySelector(".wc-select").addEventListener("change", function(event){
                selectedWeek = event.target.value;
                render();
            });
        }

        render();

        return { refresh: render };
    }

    window.CrownWeeklyChallenge = { mount: mount };
})();
