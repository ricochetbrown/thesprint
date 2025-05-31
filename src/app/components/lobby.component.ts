import { Component, inject, signal, OnInit } from "@angular/core";
import { AuthService } from "../services/auth.service";
import { GameService } from "../services/game.service";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";

// --- Lobby Component ---
@Component({
    selector: 'app-lobby',
    standalone: true,
    template: `
       <div class="min-h-screen flex flex-col" style="background-image: url('https://via.placeholder.com/1920x1080/3D4852/FFFFFF?Text=Lobby+Background'); background-size: cover;">
            <nav class="bg-black bg-opacity-50 p-4 flex justify-between items-center shadow-lg">
                <img src="https://via.placeholder.com/120/007ACC/FFFFFF?Text=SPRINT" alt="The Sprint Logo" class="h-10">
                <div class="text-xl font-semibold">
                    Game Lobby: {{ gameService.currentGame()?.name }} (Code: {{ gameService.activeGameId() }})
                </div>
                <button (click)="gameService.leaveGame()" class="text-red-400 hover:text-red-200">Leave Lobby</button>
            </nav>

            @if (gameService.currentGame(); as game) {
                <div class="container mx-auto p-8 flex-grow flex flex-col md:flex-row gap-6">
                    <div class="md:w-1/3 space-y-6">
                        <div class="bg-slate-700 bg-opacity-85 p-6 rounded-lg shadow-xl">
                            <h2 class="text-2xl font-semibold mb-4 border-b border-slate-600 pb-2">Game Settings</h2>
                            <p><strong>Host:</strong> {{ game.hostName }}</p>
                            <p><strong>Players:</strong> {{ objectKeys(game.players).length }} / {{ game.settings.maxPlayers }}</p>
                            <p><strong>Visibility:</strong> {{ game.settings.isPublic ? 'Public' : 'Private' }}</p>
                        </div>

                        <!-- Role Selection Section (Only visible to host) -->
                        @if (authService.userId() === game.hostId) {
                            <div class="bg-slate-700 bg-opacity-85 p-6 rounded-lg shadow-xl">
                                <h2 class="text-2xl font-semibold mb-4 border-b border-slate-600 pb-2">Optional Roles</h2>
                                <p class="mb-3 text-sm text-gray-300">Select which optional roles to include in the game:</p>

                                <div class="space-y-2">
                                    <div class="flex items-center">
                                        <input type="checkbox" id="includeDuke" [checked]="includeDuke()" (change)="includeDuke.set($event.target.checked)" class="mr-2">
                                        <label for="includeDuke" class="cursor-pointer">
                                            <span class="font-medium">Duke</span> - Dexter team, knows Sinister team members
                                        </label>
                                    </div>

                                    <div class="flex items-center">
                                        <input type="checkbox" id="includeSupportManager" [checked]="includeSupportManager()" (change)="includeSupportManager.set($event.target.checked)" class="mr-2">
                                        <label for="includeSupportManager" class="cursor-pointer">
                                            <span class="font-medium">Support Manager</span> - Dexter team, knows the Duke
                                        </label>
                                    </div>

                                    <div class="flex items-center">
                                        <input type="checkbox" id="includeNerlin" [checked]="includeNerlin()" (change)="includeNerlin.set($event.target.checked)" class="mr-2">
                                        <label for="includeNerlin" class="cursor-pointer">
                                            <span class="font-medium">Nerlin</span> - Sinister team, hidden from Duke
                                        </label>
                                    </div>

                                    <div class="flex items-center">
                                        <input type="checkbox" id="includeDevSlayer" [checked]="includeDevSlayer()" (change)="includeDevSlayer.set($event.target.checked)" class="mr-2">
                                        <label for="includeDevSlayer" class="cursor-pointer">
                                            <span class="font-medium">Dev Slayer</span> - Sinister team, appears as Duke to Support Manager
                                        </label>
                                    </div>
                                </div>
                            </div>
                        }
                        <div class="bg-slate-700 bg-opacity-85 p-6 rounded-lg shadow-xl">
                            <h2 class="text-2xl font-semibold mb-4 border-b border-slate-600 pb-2">Players</h2>
                            <div class="space-y-3">
                                @for (playerId of game.playerOrder; track playerId) {
                                    <div class="flex items-center gap-3 p-2 bg-slate-800 rounded">
                                        <img src="https://via.placeholder.com/60/{{ getPlayerColor(playerId) }}/FFFFFF?Text={{game.players[playerId].name.substring(0,1).toUpperCase() || 'P'}}" alt="Avatar" class="w-12 h-12 rounded-full border-2" [style.borderColor]="'#' + getPlayerColor(playerId)">
                                        <span class="font-medium text-lg">{{ game.players[playerId].name }} {{ game.players[playerId].isHost ? '(Host)' : '' }}</span>
                                        @if (playerId === authService.userId()) {
                                            <span class="text-xs text-yellow-300 ml-auto">(You)</span>
                                        }
                                    </div>
                                }
                            </div>
                            @if (objectKeys(game.players).length < game.settings.maxPlayers) {
                                <p class="text-center text-gray-400 mt-4">
                                    Waiting for {{ game.settings.maxPlayers - objectKeys(game.players).length }} more player(s)...
                                </p>
                            }
                        </div>
                    </div>

                    <div class="md:w-2/3 bg-slate-700 bg-opacity-85 p-6 rounded-lg shadow-xl flex flex-col">
                        <h2 class="text-2xl font-semibold mb-4 border-b border-slate-600 pb-2">Lobby Chat (Conceptual)</h2>
                        <div class="flex-grow bg-slate-800 p-3 rounded mb-4 min-h-[200px]"></div>
                        <form class="flex gap-2">
                            <input type="text" class="flex-grow p-3 bg-slate-600 rounded border border-slate-500" placeholder="Type your message...">
                            <button type="submit" class="bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-5 rounded">Send</button>
                        </form>

                        <div class="mt-6 text-center">
                            @if (authService.userId() === game.hostId) {
                                @if (objectKeys(game.players).length < game.settings.maxPlayers) {
                                <button (click)="fillWithAIPlayers()"
                                        [disabled]="objectKeys(game.players).length >= game.settings.maxPlayers"
                                        class="bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-3 px-6 rounded-lg text-xl disabled:opacity-50 disabled:cursor-not-allowed mr-4">
                                    Fill with AI
                                </button>
                                }

                                <button (click)="handleStartGame()"
                                        [disabled]="objectKeys(game.players).length < 5 || objectKeys(game.players).length > 12"
                                        class="bg-green-500 hover:bg-green-600 text-white font-bold py-3 px-8 rounded-lg text-xl disabled:opacity-50 disabled:cursor-not-allowed" [class.bg-red-500]="objectKeys(game.players).length > 12">
                                    {{ objectKeys(game.players).length < 5 ? 'Need Min 5 Players' : 'Start Game' }}
                                </button>
                            } @else {
                                <p class="text-gray-400">Waiting for host ({{game.hostName}}) to start the game...</p>
                            }
                            @if (startGameError()) {
                                <p class="text-red-400 mt-2">{{startGameError()}}</p>
                            }
                        </div>
                    </div>
                </div>
            } @else {
                <div class="text-center p-8">Loading game data or game not found...</div>
            }
        </div>
    `,
    imports: [CommonModule, FormsModule]
})
export class LobbyComponent implements OnInit {
    authService = inject(AuthService);
    gameService = inject(GameService);
    startGameError = signal<string | null>(null);

    // Role selection properties
    includeDuke = signal<boolean>(true); // Duke is included by default
    includeSupportManager = signal<boolean>(false);
    includeNerlin = signal<boolean>(false);
    includeDevSlayer = signal<boolean>(false);

    objectKeys = Object.keys;

    ngOnInit() {
        // Initialize role selection based on current game settings if available
        const game = this.gameService.currentGame();
        if (game && game.settings.optionalRoles) {
            this.includeDuke.set(game.settings.optionalRoles.includeDuke);
            this.includeSupportManager.set(game.settings.optionalRoles.includeSupportManager);
            this.includeNerlin.set(game.settings.optionalRoles.includeNerlin);
            this.includeDevSlayer.set(game.settings.optionalRoles.includeDevSlayer);
        }
    }

    getPlayerColor(playerId: string): string {
        let hash = 0;
        for (let i = 0; i < playerId.length; i++) {
            hash = playerId.charCodeAt(i) + ((hash << 5) - hash);
            hash = hash & hash;
        }
        const color = Math.abs(hash).toString(16).substring(0, 6);
        return "000000".substring(0, 6 - color.length) + color;
    }

    async handleStartGame() {
        this.startGameError.set(null);
        try {
            // First update the game settings with the selected roles
            await this.gameService.updateGameSettings({
                includeDuke: this.includeDuke(),
                includeSupportManager: this.includeSupportManager(),
                includeNerlin: this.includeNerlin(),
                includeDevSlayer: this.includeDevSlayer()
            });

            // Then start the game
            await this.gameService.startGame();
        } catch (error: any) {
            this.startGameError.set(error.message || "Failed to start game.");
            console.error("Start game error:", error);
        }
    }

    async fillWithAIPlayers() {
        const game = this.gameService.currentGame();
        console.log('Game object:', game);
        if (game && game.id) {
            const playersNeeded = game.settings.maxPlayers - this.objectKeys(game.players).length;
            if (playersNeeded > 0) {
                console.log('Game ID:', game.id);
                await this.gameService.addAIPlayers(game.id, playersNeeded);
            }
        }
    }
}
