import { effect, inject, Injectable } from '@angular/core';

// Firebase Imports (ensure you have firebase installed: npm install firebase)
import { getAuth } from 'firebase/auth';
import { getFirestore, Firestore, doc, getDoc, setDoc, updateDoc, onSnapshot, collection, query, addDoc, getDocs, serverTimestamp, Unsubscribe } from 'firebase/firestore';
import { AuthService } from './auth.service';

// --- Configuration (Expected to be provided globally) ---
declare var __app_id: string | undefined;

const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-sprint-app-id';

// --- Firestore Service ---
@Injectable({ providedIn: 'root' })
export class FirestoreService {
    private db: Firestore | null = null;
    private authService = inject(AuthService);

    constructor() {
        // Wait for auth to be ready before initializing Firestore
        effect(() => {
            if (this.authService.isAuthReady() && this.authService.currentUser() !== undefined && !this.db) {
                 if (getAuth().app) { // Ensure firebaseApp is initialized
                    this.db = getFirestore(getAuth().app);
                    console.log("Firestore initialized.");
                } else {
                    console.error("Firebase app not initialized for Firestore.");
                }
            }
        });
    }

    // Helper to get user-specific collection path
    private getUserCollectionPath(collectionName: string): string | null {
        const currentUserId = this.authService.userId();
        if (!currentUserId) {
            console.error("User ID not available for user collection path.");
            return null;
        }
        return `artifacts/${appId}/users/${currentUserId}/${collectionName}`;
    }

    // Helper to get public collection path
    private getPublicCollectionPath(collectionName: string): string {
         return `artifacts/${appId}/public/data/${collectionName}`;
    }

    async createDocument<T>(collectionName: string, data: T, id?: string, isPublic: boolean = false): Promise<string> {
        if (!this.db) throw new Error("Firestore not initialized");
        const path = isPublic ? this.getPublicCollectionPath(collectionName) : this.getUserCollectionPath(collectionName);
        if (!path) throw new Error("Could not determine collection path.");

        const collRef = collection(this.db, path);
        if (id) {
            await setDoc(doc(collRef, id), { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
            return id;
        } else {
            const docRef = await addDoc(collRef, { ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
            return docRef.id;
        }
    }

    async getDocument<T>(collectionName: string, docId: string, isPublic: boolean = false): Promise<T | null> {
        if (!this.db) throw new Error("Firestore not initialized");
        const path = isPublic ? this.getPublicCollectionPath(collectionName) : this.getUserCollectionPath(collectionName);
        if (!path) throw new Error("Could not determine collection path.");

        const docRef = doc(this.db, path, docId);
        const docSnap = await getDoc(docRef);
        return docSnap.exists() ? docSnap.data() as T : null;
    }

    async updateDocument<T>(collectionName: string, docId: string, data: Partial<T>, isPublic: boolean = false): Promise<void> {
        if (!this.db) throw new Error("Firestore not initialized");
        const path = isPublic ? this.getPublicCollectionPath(collectionName) : this.getUserCollectionPath(collectionName);
        if (!path) throw new Error("Could not determine collection path.");

        const docRef = doc(this.db, path, docId);
        await updateDoc(docRef, { ...data, updatedAt: serverTimestamp() });
    }
    
    listenToDocument<T>(collectionName: string, docId: string, callback: (data: T | null) => void, isPublic: boolean = false): Unsubscribe | null {
        if (!this.db) {
            console.error("Firestore not initialized for listening.");
            return null;
        }
        const path = isPublic ? this.getPublicCollectionPath(collectionName) : this.getUserCollectionPath(collectionName);
        if (!path) {
            console.error("Could not determine collection path for listening.");
            return null;
        }
        const docRef = doc(this.db, path, docId);
        return onSnapshot(docRef, (docSnap) => {
            callback(docSnap.exists() ? docSnap.data() as T : null);
        }, (error) => {
            console.error(`Error listening to document ${path}/${docId}:`, error);
            callback(null); // Notify listener of error or non-existence
        });
    }

    // Add more methods as needed (querying collections, etc.)
    async getCollection<T>(collectionName: string, isPublic: boolean = false, queryConstraints: any[] = []): Promise<T[]> {
        if (!this.db) throw new Error("Firestore not initialized");
        const path = isPublic ? this.getPublicCollectionPath(collectionName) : this.getUserCollectionPath(collectionName);
        if (!path) throw new Error("Could not determine collection path.");

        const collRef = collection(this.db, path);
        const q = query(collRef, ...queryConstraints);
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as unknown as T));
    }
}