import { useEffect, useState, useSyncExternalStore } from "react";
import { LogIn, LogOut, User } from "lucide-react";
import { getCurrentUser, logout, restoreSession, subscribe } from "../api/auth";
import { apiDesignStorage } from "../api/apiDesignStorage";
import { localStorageDesignStorage, setActiveDesignStorage } from "../designStorage";
import { AccountModal } from "./AccountModal";

/**
 * The only place designStorage.ts's active backend actually gets
 * switched (see that file's doc comment) — mounted once, alongside the
 * toolbar's "Designs" button, under the same `!hideLocalDesignLibrary`
 * gate: a host that hides the local design library (moxproxies-website's
 * embed) manages its own persistence entirely and has no use for this
 * app's own accounts/cloud-storage concept either, so it's the same
 * on/off switch. Restoring a stored session (a page reload while signed
 * in) and reacting to sign-in/sign-out both live in this one effect.
 */
export function AccountButton() {
  const user = useSyncExternalStore(subscribe, getCurrentUser);
  const [showModal, setShowModal] = useState(false);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    restoreSession().finally(() => setRestoring(false));
  }, []);

  useEffect(() => {
    setActiveDesignStorage(user ? apiDesignStorage : localStorageDesignStorage);
  }, [user]);

  if (restoring) return null;

  if (user) {
    return (
      <button
        className="cs-btn"
        onClick={() => {
          if (window.confirm("Sign out? You'll go back to designs saved only in this browser.")) void logout();
        }}
        title={`Signed in as ${user.email} — designs save to your account. Click to sign out.`}
      >
        <User size={16} /> {user.name} <LogOut size={14} />
      </button>
    );
  }

  return (
    <>
      <button className="cs-btn" onClick={() => setShowModal(true)} title="Sign in to save designs to your account instead of just this browser">
        <LogIn size={16} /> Sign in
      </button>
      {showModal && <AccountModal onSignedIn={() => setShowModal(false)} onClose={() => setShowModal(false)} />}
    </>
  );
}
