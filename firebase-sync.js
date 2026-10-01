// Firebase Auth (Google) + Firestore sync. Loaded as an ES module; exposes window.cloud.
// The config below is public by design. Access is enforced by Firestore security rules.
const firebaseConfig = {
  apiKey: "AIzaSyClLGKZqbDPYhSxWTW4YAWfV8ZOQoVdGjI",
  authDomain: "workout-tracker-67216.firebaseapp.com",
  projectId: "workout-tracker-67216",
  storageBucket: "workout-tracker-67216.firebasestorage.app",
  messagingSenderId: "343180961788",
  appId: "1:343180961788:web:695f3bc990f81c1b603479"
};

const V = '11.10.0';
const BASE = `https://www.gstatic.com/firebasejs/${V}`;

try {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`${BASE}/firebase-app.js`),
    import(`${BASE}/firebase-auth.js`),
    import(`${BASE}/firebase-firestore.js`)
  ]);

  const app = initializeApp(firebaseConfig);
  const auth = A.getAuth(app);
  const db = F.initializeFirestore(app, {
    localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() })
  });
  const provider = new A.GoogleAuthProvider();

  const workoutsCol = uid => F.collection(db, 'users', uid, 'workouts');
  const profileDoc = uid => F.doc(db, 'users', uid, 'settings', 'profile');
  const clean = obj => JSON.parse(JSON.stringify(obj)); // Firestore rejects undefined
  const uid = () => {
    if (!auth.currentUser) throw new Error('Not signed in');
    return auth.currentUser.uid;
  };

  window.cloud = {
    get user() { return auth.currentUser; },
    onAuthChange: cb => A.onAuthStateChanged(auth, cb),
    async signIn() {
      try {
        await A.signInWithPopup(auth, provider);
      } catch (e) {
        // Popups are blocked in some mobile/standalone contexts; redirect works there.
        if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
          await A.signInWithRedirect(auth, provider);
        } else if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
          throw e;
        }
      }
    },
    signOut: () => A.signOut(auth),
    async fetchWorkouts() {
      const snap = await F.getDocs(workoutsCol(uid()));
      return snap.docs.map(d => d.data());
    },
    saveWorkout: w => F.setDoc(F.doc(workoutsCol(uid()), String(w.id)), clean(w)),
    removeWorkout: id => F.deleteDoc(F.doc(workoutsCol(uid()), String(id))),
    async saveWorkouts(list) {
      const u = uid();
      for (let i = 0; i < list.length; i += 400) { // batches are limited to 500 writes
        const batch = F.writeBatch(db);
        list.slice(i, i + 400).forEach(w => batch.set(F.doc(workoutsCol(u), String(w.id)), clean(w)));
        await batch.commit();
      }
    },
    async fetchProfile() {
      const snap = await F.getDoc(profileDoc(uid()));
      return snap.exists() ? snap.data() : null;
    },
    saveProfile: p => F.setDoc(profileDoc(uid()), clean(p))
  };
  A.getRedirectResult(auth).catch(() => {});
  window.dispatchEvent(new Event('cloud-ready'));
} catch (err) {
  console.warn('Cloud sync unavailable:', err);
  window.dispatchEvent(new Event('cloud-failed'));
}
