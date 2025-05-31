import { Component, inject, signal, OnInit } from "@angular/core";
import { AuthService } from "../services/auth.service";
import { GameService } from "../services/game.service";
import { FormsModule } from "@angular/forms";
import { CommonModule } from "@angular/common";
import { Game } from "../interfaces/game.interface";

// --- Dashboard Component ---
@Component({
    selector: 'app-dashboard',
    standalone: true,
    template: `
        <div class="min-h-screen p-8 pt-16" style="background-image: url('https://via.placeholder.com/1920x1080/3D4852/FFFFFF?Text=Dashboard+Background'); background-size: cover;">
            <nav class="fixed top-0 left-0 right-0 bg-black bg-opacity-50 p-4 flex justify-between items-center shadow-lg">
                <img src="https://via.placeholder.com/120/007ACC/FFFFFF?Text=SPRINT" alt="The Sprint Logo" class="h-10">
                <div>
                    <span class="mr-4">Welcome, {{ authService.currentUser()?.displayName || authService.currentUser()?.email || 'Player' }}!</span>
                    <button (click)="authService.logout()" class="text-red-400 hover:text-red-200">Logout</button>
                </div>
            </nav>

            <div class="text-center mb-12">
                <h1 class="text-5xl font-bold tracking-tight">Game Dashboard</h1>
            </div>

            <div class="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto mb-12">
                <div class="bg-slate-700 bg-opacity-85 p-6 rounded-lg shadow-2xl text-center">
                    <h2 class="text-3xl font-semibold mb-3">Create New Game</h2>
                    <button (click)="showCreateModal.set(true)" class="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-6 rounded-lg text-lg">
                        Create Game
                    </button>
                </div>
                <div class="bg-slate-700 bg-opacity-85 p-6 rounded-lg shadow-2xl text-center">
                    <h2 class="text-3xl font-semibold mb-3">Join Private Game</h2>
                    <input type="text" [(ngModel)]="joinGameId" class="w-full p-3 bg-slate-600 rounded border border-slate-500 mb-4 text-center" placeholder="Enter Game Code">
                    <button (click)="handleJoinGame()" class="w-full bg-teal-500 hover:bg-teal-600 text-black font-bold py-3 px-6 rounded-lg text-lg">
                        Join Private Game
                    </button>
                </div>
            </div>

            <div class="max-w-4xl mx-auto mb-12">
                <div class="bg-slate-700 bg-opacity-85 p-6 rounded-lg shadow-2xl">
                    <h2 class="text-3xl font-semibold mb-6 text-center">Available Public Games</h2>

                    @if (isLoading()) {
                        <div class="text-center py-8">
                            <p>Loading available games...</p>
                        </div>
                    } @else if (publicGames().length === 0) {
                        <div class="text-center py-8">
                            <p>No public games available to join.</p>
                            <button (click)="fetchPublicGames()" class="mt-4 bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded">
                                Refresh
                            </button>
                        </div>
                    } @else {
                        <div class="grid gap-4">
                            @for (game of publicGames(); track game.id) {
                                <div class="bg-slate-800 p-4 rounded-lg flex justify-between items-center">
                                    <div>
                                        <h3 class="text-xl font-semibold">{{ game.name }}</h3>
                                        <p class="text-sm text-gray-400">Host: {{ game.hostName }} | Players: {{ Object.keys(game.players).length }} / {{ game.settings.maxPlayers }}</p>
                                    </div>
                                    <button (click)="handleJoinPublicGame(game.id)" class="bg-teal-500 hover:bg-teal-600 text-black font-bold py-2 px-4 rounded">
                                        Join
                                    </button>
                                </div>
                            }
                            <div class="text-center mt-4">
                                <button (click)="fetchPublicGames()" class="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded">
                                    Refresh
                                </button>
                            </div>
                        </div>
                    }
                </div>
            </div>

            @if (actionError()) {
                <p class="text-center text-red-400 mb-4">{{actionError()}}</p>
            }

            @if (showCreateModal()) {
                <div class="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center p-4">
                    <div class="bg-slate-800 p-8 rounded-lg shadow-xl w-full max-w-lg">
                        <h2 class="text-3xl font-semibold mb-6 text-center">Configure Your Game</h2>
                        <form (submit)="handleCreateGame()">
                            <div class="mb-4">
                                <label for="gameName" class="block text-sm font-medium mb-1">Game Name (Optional)</label>
                                <input type="text" [(ngModel)]="newGameName" name="gameName" class="w-full p-3 bg-slate-600 rounded border border-slate-500" placeholder="My Awesome Sprint">
                            </div>
                            <div class="mb-4">
                                <label for="maxPlayers" class="block text-sm font-medium mb-1">Number of Players</label>
                                <select [(ngModel)]="newGameMaxPlayers" name="maxPlayers" class="w-full p-3 bg-slate-600 rounded border border-slate-500">
                                    <option value="5">5 Players</option>
                                    <option value="6">6 Players</option>
                                    <option value="7">7 Players</option>
                                    <option value="8">8 Players</option>
                                    <option value="9">9 Players</option>
                                    <option value="10">10 Players</option>
                                    <option value="11">11 Players</option>
                                    <option value="12">12 Players</option>
                                    </select>
                            </div>
                            <div class="mb-6">
                                <label class="block text-sm font-medium mb-1">Visibility</label>
                                <div class="flex gap-4">
                                    <label><input type="radio" [(ngModel)]="newGameIsPublic" name="isPublic" [value]="true" class="mr-1"> Public</label>
                                    <label><input type="radio" [(ngModel)]="newGameIsPublic" name="isPublic" [value]="false" class="mr-1"> Private</label>
                                </div>
                            </div>
                            <div class="flex justify-end gap-4">
                                <button type="button" (click)="showCreateModal.set(false)" class="bg-gray-500 hover:bg-gray-600 text-white font-bold py-2 px-4 rounded">Cancel</button>
                                <button type="submit" class="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-6 rounded">Create & Go to Lobby</button>
                            </div>
                        </form>
                    </div>
                </div>
            }
        </div>
    `,
    imports: [
        FormsModule,
        CommonModule
    ] // Add FormsModule
})
export class DashboardComponent implements OnInit {
    authService = inject(AuthService);
    gameService = inject(GameService);

    showCreateModal = signal(false);
    newGameName = '';
    newGameMaxPlayers = 7;
    newGameIsPublic = true;
    joinGameId = '';
    actionError = signal<string | null>(null);
    publicGames = signal<Game[]>([]);
    isLoading = signal<boolean>(false);

    // Helper for templates
    objectKeys = Object.keys;

    ngOnInit() {
        this.fetchPublicGames();
    }

    async fetchPublicGames() {
        this.isLoading.set(true);
        try {
            const games = await this.gameService.getPublicGames();
            this.publicGames.set(games);
        } catch (error) {
            console.error('Error fetching public games:', error);
        } finally {
            this.isLoading.set(false);
        }
    }

    async handleCreateGame() {
        this.actionError.set(null);
        try {
            const gameId = await this.gameService.createGame(this.newGameName, this.newGameMaxPlayers, this.newGameIsPublic);
            // Navigation to lobby will be handled by AppComponent effect based on activeGameId
            this.showCreateModal.set(false);
        } catch (error: any) {
            this.actionError.set(error.message || "Failed to create game.");
            console.error("Create game error:", error);
        }
    }

    async handleJoinGame() {
        this.actionError.set(null);
        if (!this.joinGameId.trim()) {
            this.actionError.set("Please enter a game code.");
            return;
        }
        try {
            await this.gameService.joinGame(this.joinGameId.trim().toUpperCase());
            // Navigation to lobby by AppComponent effect
        } catch (error: any) {
            this.actionError.set(error.message || "Failed to join game.");
            console.error("Join game error:", error);
        }
    }

    async handleJoinPublicGame(gameId: string) {
        this.actionError.set(null);
        try {
            await this.gameService.joinGame(gameId);
            // Navigation to lobby by AppComponent effect
        } catch (error: any) {
            this.actionError.set(error.message || "Failed to join game.");
            console.error("Join public game error:", error);
        }
    }
}
