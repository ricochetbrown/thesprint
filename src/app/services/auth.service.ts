import { signal, WritableSignal, inject, Injectable, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { bootstrapApplication } from '@angular/platform-browser';

// Firebase Imports (ensure you have firebase installed: npm install firebase)
import { initializeApp, FirebaseApp } from 'firebase/app';
import { getAuth, Auth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, User, signOut, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import { setLogLevel } from 'firebase/firestore';


// --- Configuration (Expected to be provided globally) ---
declare var __firebase_config: string | undefined;
declare var __initial_auth_token: string | undefined;

const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
    apiKey: "YOUR_API_KEY", // Replace with your actual Firebase config
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// --- Authentication Service ---
@Injectable({ providedIn: 'root' })
export class AuthService {
    private platformId = inject(PLATFORM_ID);
    private firebaseApp: FirebaseApp | null = null;
    private auth: Auth | null = null;

    currentUser: WritableSignal<User | null> = signal(null);
    userId: WritableSignal<string | null> = signal(null);
    isAuthReady: WritableSignal<boolean> = signal(false);

    constructor() {
        if (isPlatformBrowser(this.platformId)) {
            try {
                this.firebaseApp = initializeApp(firebaseConfig);
                this.auth = getAuth(this.firebaseApp);
                setLogLevel('debug'); // For Firebase Firestore logging

                onAuthStateChanged(this.auth, async (user) => {
                    this.currentUser.set(user);
                    this.userId.set(user ? user.uid : crypto.randomUUID()); // Use UID or random for anonymous
                    if (!this.isAuthReady()) {
                        this.isAuthReady.set(true);
                    }
                    console.log("Auth state changed. User:", user);
                });

                this.signIn();

            } catch (error) {
                console.error("Error initializing Firebase Auth:", error);
                this.isAuthReady.set(true); // Still set to true to allow app to proceed (perhaps with limited functionality)
            }
        } else {
            this.isAuthReady.set(true); // SSR: auth is not available, but set ready
        }
    }

    private async signIn() {
        if (!this.auth) return;
        try {
            if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                console.log("Attempting signInWithCustomToken...");
                await signInWithCustomToken(this.auth, __initial_auth_token);
            } else {
                console.log("Attempting signInAnonymously...");
                await signInAnonymously(this.auth);
            }
        } catch (error) {
            console.error("Error during sign-in:", error);
            // Fallback to anonymous if custom token fails for some reason
            if (this.auth && !this.auth.currentUser) {
                try {
                    await signInAnonymously(this.auth);
                } catch (anonError) {
                    console.error("Error during fallback anonymous sign-in:", anonError);
                }
            }
        }
    }

    async loginWithEmail(email: string, password: string): Promise<User | null> {
        if (!this.auth) return null;
        try {
            const userCredential = await signInWithEmailAndPassword(this.auth, email, password);
            return userCredential.user;
        } catch (error) {
            console.error("Login error:", error);
            throw error; // Re-throw to be handled by component
        }
    }

    async registerWithEmail(email: string, password: string): Promise<User | null> {
        if (!this.auth) return null;
        try {
            const userCredential = await createUserWithEmailAndPassword(this.auth, email, password);
            // You might want to set a display name here or other profile info
            return userCredential.user;
        } catch (error) {
            console.error("Registration error:", error);
            throw error;
        }
    }

    async logout() {
        if (!this.auth) return;
        try {
            await signOut(this.auth);
            // After signing out, onAuthStateChanged will trigger and set currentUser to null.
            // Forcing an anonymous sign-in again to maintain a userId if needed for app functionality.
            await this.signIn();
        } catch (error) {
            console.error("Logout error:", error);
        }
    }
}