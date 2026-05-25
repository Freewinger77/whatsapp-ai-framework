(function () {
    const STORAGE_KEY = 'wasup.dashboardOverlayDismissed';

    function injectStyles() {
        if (document.getElementById('wasup-dashboard-overlay-styles')) return;
        const style = document.createElement('style');
        style.id = 'wasup-dashboard-overlay-styles';
        style.textContent = `
            .wasup-dashboard-overlay {
                position: fixed;
                inset: 0;
                z-index: 99999;
                display: grid;
                place-items: center;
                padding: 24px;
                background: rgba(6, 8, 7, 0.72);
                backdrop-filter: blur(10px);
                animation: wasupOverlayFade 0.22s ease;
            }
            @keyframes wasupOverlayFade {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            .wasup-dashboard-overlay__card {
                width: min(100%, 440px);
                border-radius: 20px;
                border: 1px solid rgba(34, 197, 94, 0.22);
                background: linear-gradient(180deg, rgba(16, 24, 21, 0.98), rgba(9, 12, 11, 0.98));
                box-shadow: 0 28px 90px rgba(0, 0, 0, 0.45);
                padding: 28px 26px 24px;
                color: #ecfdf5;
                font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
            }
            .wasup-dashboard-overlay__eyebrow {
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 0.18em;
                text-transform: uppercase;
                color: rgba(34, 197, 94, 0.82);
            }
            .wasup-dashboard-overlay__title {
                margin: 10px 0 0;
                font-size: 24px;
                line-height: 1.15;
                font-weight: 700;
                letter-spacing: -0.03em;
            }
            .wasup-dashboard-overlay__copy {
                margin: 12px 0 0;
                font-size: 15px;
                line-height: 1.55;
                color: rgba(236, 253, 245, 0.72);
            }
            .wasup-dashboard-overlay__host {
                margin-top: 14px;
                padding: 10px 12px;
                border-radius: 12px;
                background: rgba(255, 255, 255, 0.04);
                border: 1px solid rgba(255, 255, 255, 0.08);
                font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
                font-size: 12px;
                color: rgba(236, 253, 245, 0.88);
                word-break: break-all;
            }
            .wasup-dashboard-overlay__actions {
                display: grid;
                gap: 10px;
                margin-top: 22px;
            }
            .wasup-dashboard-overlay__primary,
            .wasup-dashboard-overlay__secondary {
                appearance: none;
                border: none;
                border-radius: 12px;
                padding: 13px 16px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                transition: transform 0.15s ease, opacity 0.15s ease;
            }
            .wasup-dashboard-overlay__primary {
                background: #22c55e;
                color: #052e16;
            }
            .wasup-dashboard-overlay__secondary {
                background: rgba(255, 255, 255, 0.04);
                color: rgba(236, 253, 245, 0.82);
                border: 1px solid rgba(255, 255, 255, 0.1);
            }
            .wasup-dashboard-overlay__primary:hover,
            .wasup-dashboard-overlay__secondary:hover {
                transform: translateY(-1px);
            }
            .wasup-dashboard-overlay__primary:active,
            .wasup-dashboard-overlay__secondary:active {
                transform: scale(0.98);
            }
        `;
        document.head.appendChild(style);
    }

    function mountOverlay(config) {
        injectStyles();

        const overlay = document.createElement('div');
        overlay.className = 'wasup-dashboard-overlay';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', 'wasup-dashboard-overlay-title');

        const dashboardUrl = config.dashboardUrl;
        const workerHost = config.workerHost || window.location.host;

        overlay.innerHTML = `
            <div class="wasup-dashboard-overlay__card">
                <div class="wasup-dashboard-overlay__eyebrow">Wasup workspace worker</div>
                <h2 class="wasup-dashboard-overlay__title" id="wasup-dashboard-overlay-title">Manage this number in the dashboard</h2>
                <p class="wasup-dashboard-overlay__copy">
                    This page is the raw worker for your provisioned workspace. Day-to-day instance control, pairing, team access, and billing live on dev.wasup.co.
                </p>
                <div class="wasup-dashboard-overlay__host">${workerHost}</div>
                <div class="wasup-dashboard-overlay__actions">
                    <button type="button" class="wasup-dashboard-overlay__primary" data-action="dashboard">
                        Back to dev.wasup.co
                    </button>
                    <button type="button" class="wasup-dashboard-overlay__secondary" data-action="continue">
                        Continue on worker page
                    </button>
                </div>
            </div>
        `;

        overlay.querySelector('[data-action="dashboard"]').addEventListener('click', function () {
            window.location.href = dashboardUrl;
        });

        overlay.querySelector('[data-action="continue"]').addEventListener('click', function () {
            sessionStorage.setItem(STORAGE_KEY, '1');
            overlay.remove();
        });

        document.body.appendChild(overlay);
    }

    async function init() {
        if (sessionStorage.getItem(STORAGE_KEY)) return;
        if (window.location.pathname !== '/' && window.location.pathname !== '') return;

        try {
            const response = await fetch('/api/dashboard-config', { credentials: 'same-origin' });
            if (!response.ok) return;
            const config = await response.json();
            if (!config.showDashboardReturnOverlay || !config.dashboardUrl) return;
            mountOverlay(config);
        } catch {
            /* ignore */
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
