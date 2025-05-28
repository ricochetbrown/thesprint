import { Component, OnInit, signal, WritableSignal, effect, inject } from '@angular/core';

// Firebase Imports (ensure you have firebase installed: npm install firebase)
import { LoginComponent } from './components/login.component';
import { DashboardComponent } from './components/dashboard.component';
import { LobbyComponent } from './components/lobby.component';
import { GameBoardComponent } from './components/gameboard.component';
import { AuthService } from './services/auth.service';
import { GameService } from './services/game.service';


// --- Configuration (Expected to be provided globally) ---
declare var __app_id: string | undefined;
declare var __firebase_config: string | undefined;
declare var __initial_auth_token: string | undefined;

const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-sprint-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
    apiKey: "YOUR_API_KEY", // Replace with your actual Firebase config
    authDomain: "YOUR_AUTH_DOMAIN",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_STORAGE_BUCKET",
    messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// --- App Component (Main Router/View Manager) ---
@Component({
    selector: 'app-root',
    standalone: true,
    template: `
        <div class="min-h-screen bg-gray-900 text-white">
            <div *ngIf="!authService.isAuthReady()" class="flex items-center justify-center h-screen">
                Loading Authentication...
            </div>

            <ng-container *ngIf="authService.isAuthReady()">
                <app-login *ngIf="!authService.currentUser() && activeView() === 'login'"></app-login>
                
                <ng-container *ngIf="authService.currentUser()">
                    <app-dashboard *ngIf="activeView() === 'dashboard' && !gameService.activeGameId()"></app-dashboard>
                    <app-lobby *ngIf="gameService.activeGameId() && gameService.currentGame()?.status === 'lobby'"></app-lobby>
                    <app-game-board *ngIf="gameService.activeGameId() && gameService.currentGame()?.status !== 'lobby'"></app-game-board>
                </ng-container>
            </ng-container>
        </div>
    `,
    imports: [LoginComponent, DashboardComponent, LobbyComponent, GameBoardComponent] // Import standalone components
})
export class AppComponent implements OnInit {
    authService = inject(AuthService);
    gameService = inject(GameService);
    activeView: WritableSignal<string> = signal('login'); // 'login', 'dashboard', 'lobby', 'game'

    constructor() {
        // Effect to manage view based on auth and game state
        effect(() => {
            const user = this.authService.currentUser();
            const game = this.gameService.currentGame();
            const activeGameId = this.gameService.activeGameId();

            if (!user) {
                this.activeView.set('login');
            } else {
                if (!activeGameId) {
                    this.activeView.set('dashboard');
                } else {
                    if (game?.status === 'lobby') {
                        this.activeView.set('lobby');
                    } else if (game?.status) {
                        this.activeView.set('game'); // This will trigger GameBoardComponent
                    } else {
                         this.activeView.set('dashboard'); // Fallback if game state is unclear
                    }
                }
            }
            console.log("Active view set to:", this.activeView());
        });
    }

    ngOnInit() {
        // Initial check, effect will handle subsequent changes
        if (this.authService.currentUser()) {
            if (!this.gameService.activeGameId()) {
                this.activeView.set('dashboard');
            } else {
                // Further logic based on game status if needed, or rely on effect
            }
        } else {
            this.activeView.set('login');
        }
    }
}
