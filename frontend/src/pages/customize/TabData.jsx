import React, { useState } from 'react';
import { useCustomize, DEFAULTS } from '../../components/CustomizePanel';

/**
 * TabData — what can actually be done today.
 *
 * The handover specs a session list, an async export and a queued account
 * deletion against GET /v1/me/sessions, POST /v1/me/export and POST
 * /v1/me/delete. None of those endpoints exist in the backend — there is no
 * user_preferences table and no /me/sessions router. Building the UI now would
 * ship three controls that 404 on click, which is worse than not shipping them:
 * a dead "sign out all devices" button reads as a security control the user
 * believes they have used.
 *
 * So this tab does the two things that are real and entirely client-side, and
 * says plainly what is not built yet rather than faking it.
 */
export default function TabData() {
  const { prefs, setPrefs } = useCustomize();
  const [confirming, setConfirming] = useState(false);

  const exportPrefs = () => {
    const blob = new Blob([JSON.stringify(prefs, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url;
    a.download = 'kartavaya-preferences.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="st__group">
      <div className="sr">
        <div className="sr__l">
          <div className="sr__t">Export preferences</div>
          <div className="sr__d">
            Downloads your appearance, typography and layout settings as JSON.
          </div>
        </div>
        <div className="sr__c">
          <button className="k-btn k-btn--ghost k-btn--sm" onClick={exportPrefs}>Download</button>
        </div>
      </div>

      <div className="sr">
        <div className="sr__l">
          <div className="sr__t">Storage</div>
          <div className="sr__d">
            Preferences are stored on this device and applied before the first paint,
            so changing a theme never waits on the network. They don’t sync between
            devices yet.
          </div>
        </div>
      </div>

      <div style={{ marginTop: 20 }}>
        <div className="dz">
          <div className="dz__t">Reset all preferences</div>
          <div className="dz__d">
            Returns every setting on this page to its default. Your tasks, projects
            and account are untouched.
          </div>
          {confirming ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button
                className="dz__b"
                style={{ marginTop: 0 }}
                onClick={() => { setPrefs({ ...DEFAULTS }); setConfirming(false); }}
              >
                Yes, reset everything
              </button>
              <button
                className="k-btn k-btn--ghost k-btn--sm"
                onClick={() => setConfirming(false)}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button className="dz__b" onClick={() => setConfirming(true)}>
              Reset to defaults
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
