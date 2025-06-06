import { Component, OnInit, signal, WritableSignal, effect, inject } from '@angular/core';

// Firebase Imports (ensure you have firebase installed: npm install firebase)
import { LoginComponent } from './components/login.component';
import { DashboardComponent } from './components/dashboard.component';
import { LobbyComponent } from './components/lobby.component';
import { GameBoardComponent } from './components/gameboard.component';
import { AuthService } from './services/auth.service';
import { GameService } from './services/game.service';

// --- App Component (Main Router/View Manager) ---
@Component({
    selector: 'app-root',
    standalone: true,
    template: `
        <div class="min-h-screen bg-gray-900 text-white">
            @if (!authService.isAuthReady()) {
                <div class="flex items-center justify-center h-screen">
                    Loading Authentication...
                </div>
            }

            @if (authService.isAuthReady()) {
                @if (!authService.currentUser() && activeView() === 'login') {
                    <app-login></app-login>
                }

                @if (authService.currentUser()) {
                    @if (activeView() === 'dashboard' && !gameService.activeGameId()) {
                        <app-dashboard></app-dashboard>
                    } @else if (gameService.activeGameId() && gameService.currentGame()?.status === 'lobby') {
                        <app-lobby></app-lobby>
                    } @else if (gameService.activeGameId() && gameService.currentGame()?.status !== 'lobby') {
                        <app-game-board></app-game-board>
                    }
                }
            }
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
