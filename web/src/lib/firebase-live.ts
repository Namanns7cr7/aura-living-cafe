"use client";

import { getApps, initializeApp } from "firebase/app";
import { collection, doc, getFirestore, onSnapshot, query, where } from "firebase/firestore";
import { getCafeId } from "./api";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "",
};

export function isFirebaseClientConfigured(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
}

/**
 * Attaches real Firestore onSnapshot listeners on tables, demoState, and (when authenticated) orders.
 * Returns null if Firebase web config is not provided (e.g., local memory mode).
 */
export function subscribeFirestoreSnapshots(
  onUpdate: (source: string) => void,
  options?: { userId?: string | null; isStaff?: boolean }
): (() => void) | null {
  if (typeof window === "undefined" || !isFirebaseClientConfigured()) {
    return null;
  }

  try {
    const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
    const db = getFirestore(app);
    const cafeId = getCafeId();
    const unsubs: (() => void)[] = [];

    // Public tables collection
    unsubs.push(
      onSnapshot(
        collection(db, "cafes", cafeId, "tables"),
        () => onUpdate("firestore:tables"),
        () => {}
      )
    );

    // Public demoState doc
    unsubs.push(
      onSnapshot(
        doc(db, "cafes", cafeId, "demoState", "current"),
        () => onUpdate("firestore:demoState"),
        () => {}
      )
    );

    // Scoped orders listener (customer own orders or café-scoped staff)
    if (options?.isStaff) {
      unsubs.push(
        onSnapshot(
          collection(db, "cafes", cafeId, "orders"),
          () => onUpdate("firestore:orders"),
          () => {}
        )
      );
    } else if (options?.userId) {
      unsubs.push(
        onSnapshot(
          query(collection(db, "cafes", cafeId, "orders"), where("userId", "==", options.userId)),
          () => onUpdate("firestore:orders"),
          () => {}
        )
      );
    }

    return () => {
      for (const u of unsubs) u();
    };
  } catch {
    return null;
  }
}
