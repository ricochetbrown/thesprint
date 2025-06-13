import { Component, computed, inject } from "@angular/core";
import { Game } from "../interfaces/game.interface";
import { AuthService } from "../services/auth.service";
import { GameService } from "../services/game.service";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { MANAGEMENT_CARDS } from "../interfaces/management-card.interface";

// --- Game Board Component (Very Basic Stub) ---
@Component({
    selector: 'app-game-board',
    standalone: true,
    template: `
        <div class="min-h-screen flex flex-col relative" style="background-image: url('https://via.placeholder.com/1920x1080/1A202C/FFFFFF?Text=Game+Board+Background'); background-size: cover;">
            <nav class="bg-black bg-opacity-60 p-3 flex justify-between items-center shadow-lg text-sm sticky top-0 z-20">
                <div>Game: {{ gameService.currentGame()?.name }} - Round: {{ gameService.currentGame()?.currentStoryNum }} / {{ gameService.currentGame()?.storiesTotal }}</div>
                <div>My Role: <span class="font-bold text-cyan-400">{{ myRole() }}</span></div>
                <button (click)="toggleSidebar()" class="bg-purple-600 hover:bg-purple-700 px-2 py-1 rounded text-xs">
                    {{ showSidebar ? 'Hide' : 'Show' }} Cards & Roles
                </button>
                <button (click)="gameService.leaveGame()" class="text-red-300 hover:text-red-100">Quit Game</button>
            </nav>

            @if (gameService.currentGame(); as game) {

            }

            @if (gameService.currentGame(); as game) {
                <div class="flex-grow container mx-auto p-4">
                    <div class="flex flex-wrap justify-center items-center gap-2 md:gap-4 p-2 md:p-4 mb-4">
                        @for (playerId of game.playerOrder; track playerId) {
                            <div class="flex flex-col items-center">
                                <div class="rounded-full text-center w-20 h-20 md:w-24 md:h-24 flex justify-center items-center border-2 mb-1 relative"
                                     [ngClass]="{
                                        'border-gray-600': playerId !== game.currentTO_id,
                                        'border-indigo-600 shadow-indigo-400/50 shadow-lg': isPlayerDukeForSupportManager(playerId, game)
                                     }">
                                    <img [src]="getPlayerAvatarUrl(playerId, game)" alt="P" class="w-16 h-16 md:w-20 md:h-20 rounded-full">
                                    <!-- Technical Owner overlay -->
                                    @if (playerId === game.currentTO_id) {
                                        <img src="assets/technicalowner.png" alt="TO" class="absolute" style="width: 5rem; height: 5rem; top: -30px; right: -20px;">
                                    }
                                    <!-- Team member overlay (for both proposed and approved teams) -->
                                    @if (game.mission?.team!.includes(playerId) || game.teamVote?.proposedTeam!.includes(playerId)) {
                                        <img src="assets/supercoder.png" alt="Team" class="absolute top-0 left-[-5px] w-8 h-[2rem] md:w-10">
                                    }
                                    <!-- Management designated player overlay -->
                                    @if (playerId === game.managementDesignatedPlayer || playerId === game.proposedManagementDesignatedPlayer) {
                                        <img src="assets/management/guido.png" alt="Management" class="absolute top-[-10px] left-[-5px] h-[4rem] w-[2rem]">
                                    }
                                    <!-- Management card indicator -->
                                    @if (getPlayerManagementCard(playerId, game)) {
                                        <div class="absolute bottom-0 right-0 bg-purple-600 rounded-full w-6 h-6 flex items-center justify-center" title="Has Management Card">
                                            <span class="text-white text-xs">M</span>
                                        </div>
                                    }
                                </div>
                                <div class="text-center">
                                    <span class="text-xs md:text-sm truncate w-full block">{{ game.players[playerId].name }}</span>
                                    @if (isPlayerDukeForSupportManager(playerId, game)) {
                                        <span class="text-xs text-indigo-300 font-bold">(Duke)</span>
                                    }
                                    @if (hasLoyaltyBeenRevealed(playerId, game)) {
                                        <span class="text-xs font-bold" [ngClass]="{'text-blue-300': getPlayerSquadLoyalty(playerId, game) === 'dexter', 'text-red-300': getPlayerSquadLoyalty(playerId, game) === 'sinister'}">
                                            ({{ getPlayerSquadLoyalty(playerId, game) === 'dexter' ? 'Dexter' : 'Sinister' }})
                                        </span>
                                    }
                                    @if (game.status === 'teamVoting' && game.teamVote?.votes) {
                                        <span class="text-xs" [ngClass]="{'text-yellow-300': game.teamVote?.votes?.[playerId] === undefined, 'text-green-300': game.teamVote?.votes?.[playerId] === 'agree', 'text-red-300': game.teamVote?.votes?.[playerId] === 'rethrow'}">
                                            {{ game.teamVote?.votes?.[playerId] ? (game.teamVote?.votes?.[playerId] === 'agree' ? 'Agreed' : 'Rethrow') : 'Not Voted' }}
                                        </span>
                                    }
                                </div>
                            </div>
                        }
                    </div>

                    <div class="bg-slate-800 bg-opacity-80 p-3 my-2 flex flex-col md:flex-row justify-around items-center text-sm sticky top-[calc(env(safe-area-inset-top)_+_3.5rem)] z-10 shadow-md rounded">
                        <div>
                            User Stories:
                            <span class="flex">
                                @for (result of game.storyResults; track $index) {
                                    <span class="w-10 h-6 md:w-12 md:h-8 border mx-0.5 flex items-center justify-center text-xs rounded cursor-help"
                                          [ngClass]="{
                                            'bg-blue-500 border-blue-400': result === 'dexter',
                                            'bg-red-500 border-red-400': result === 'sinister',
                                            'bg-gray-600 border-gray-500': result === null
                                          }"
                                          [title]="getMissionHistoryInfo(game, $index)">
                                        OD-{{ $index + 1 }}
                                    </span>
                                }
                            </span>
                        </div>
                        <div class="my-1 md:my-0">Current Phase: <strong class="text-yellow-400">{{ game.status | titlecase }}</strong></div>
                        <div>
                            Rethrows: <span class="font-bold">{{ game.voteFailsThisRound || 0 }}</span> / 5
                        </div>
                        <div class="my-1 md:my-0">
                            Management: <span class="font-bold">{{ game.managementDeck?.length || 0 }}</span> cards left
                            @if (game.discardedManagementCards && game.discardedManagementCards.length > 0) {
                                <span class="text-xs cursor-help" [title]="getDiscardedCardsTooltip(game)">
                                    ({{ game.discardedManagementCards.length }} discarded)
                                </span>
                            }
                        </div>
                    </div>

                    <div class="bg-slate-700 bg-opacity-90 p-4 md:p-6 rounded-lg shadow-xl min-h-[200px] md:min-h-[300px] flex flex-col items-center justify-center">
                        <h2 class="text-2xl font-semibold mb-4">{{ getPhaseTitle(game.status) }}</h2>

                        @switch (game.status) {
                            @case ('teamProposal') {
                                <div>
                                    @if (authService.userId() === game.currentTO_id) {
                                        <p class="mb-2">
                                            You are the TO. Select {{ getNumToSelect(game) }} players for User Story OD-{{game.currentStoryNum}}.
                                        </p>
                                        <div class="flex flex-wrap gap-2 mb-4">
                                            @for (playerId of game.playerOrder; track playerId) {
                                                <button class="px-3 py-1 rounded"
                                                        [ngClass]="{'bg-blue-500 text-white': selectedPlayers.includes(playerId), 'bg-gray-300 text-black': !selectedPlayers.includes(playerId)}"
                                                        (click)="togglePlayerSelection(playerId, game)">
                                                        {{ game.players[playerId]?.name }}
                                                </button>
                                            }
                                        </div>

                                        <!-- Management card designation (only for stories 1-4) -->
                                        @if ((game.currentStoryNum || 1) <= 4) {
                                            <div class="mt-4 mb-4">
                                                <p class="mb-2">Select a player not on the team to receive a management card:</p>
                                                <div class="flex flex-wrap gap-2">
                                                    @for (playerId of game.playerOrder; track playerId) {
                                                        @if (!selectedPlayers.includes(playerId)) {
                                                            <button class="px-3 py-1 rounded"
                                                                    [ngClass]="{'bg-purple-500 text-white': managementDesignatedPlayer === playerId, 'bg-gray-300 text-black': managementDesignatedPlayer !== playerId}"
                                                                    (click)="toggleManagementDesignation(playerId)">
                                                                    {{ game.players[playerId]?.name }}
                                                            </button>
                                                        }
                                                    }
                                                </div>
                                            </div>
                                        }

                                        <button (click)="proposeTeam(game)"
                                                [disabled]="selectedPlayers.length !== getNumToSelect(game)"
                                                class="bg-green-500 hover:bg-green-600 px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed">
                                                Propose Team
                                        </button>
                                    } @else {
                                        <p class="mb-2">
                                            Waiting for {{ game.players[game.currentTO_id!].name }} (TO) to propose a team.
                                        </p>
                                    }
                                    <!-- Removed duplicate Propose Team button -->
                                </div>
                            }
                            @case ('shiftingPriorities') {
                                <div>
                                    {{ initializeSelectedPlayers(game) }}
                                    @if (authService.userId() === game.currentTO_id) {
                                        <p class="mb-2">
                                            You are the TO. The Shifting Priorities card has been played.
                                            <strong class="text-yellow-300">You must keep the current team and add exactly one more player.</strong>
                                        </p>
                                        <p class="mb-2">
                                            Current team: <span class="font-bold">{{ getOriginalTeamNames(game) }}</span>
                                        </p>
                                        <div class="flex flex-wrap gap-2 mb-4">
                                            @for (playerId of game.playerOrder; track playerId) {
                                                <button class="px-3 py-1 rounded"
                                                        [ngClass]="{
                                                            'bg-blue-500 text-white': selectedPlayers.includes(playerId),
                                                            'bg-gray-300 text-black': !selectedPlayers.includes(playerId),
                                                            'opacity-70 cursor-not-allowed': isOriginalTeamMember(playerId, game)
                                                        }"
                                                        [title]="isOriginalTeamMember(playerId, game) ? 'This player was on the original team and cannot be removed' : ''"
                                                        (click)="togglePlayerSelection(playerId, game)">
                                                        {{ game.players[playerId]?.name }}
                                                        @if (isOriginalTeamMember(playerId, game)) {
                                                            <span class="text-xs">*</span>
                                                        }
                                                </button>
                                            }
                                        </div>

                                        <button (click)="submitShiftingPrioritiesTeam(game)"
                                                [disabled]="selectedPlayers.length !== game.teamProposal?.numToSelect"
                                                class="bg-green-500 hover:bg-green-600 px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed">
                                                Submit Team
                                        </button>
                                    } @else {
                                        <p class="mb-2">
                                            The Shifting Priorities card has been played. Waiting for {{ game.players[game.currentTO_id!].name }} (TO) to select a team for User Story OD-{{game.currentStoryNum}}.
                                        </p>
                                        <p class="mb-2">
                                            <strong class="text-yellow-300">The TO must keep the current team and add exactly one more player.</strong>
                                        </p>
                                        <p class="mb-2">
                                            Current team: <span class="font-bold">{{ getOriginalTeamNames(game) }}</span>
                                        </p>
                                    }
                                </div>
                            }
                            @case ('teamVoting') {
                                <div>
                                    <!-- Management Phase UI (when in teamVoting status but management phase is active) -->
                                    @if (game.managementPhase && authService.userId() === game.managementDesignatedPlayer) {
                                        <div class="bg-purple-800 bg-opacity-80 p-4 rounded-lg mb-4">
                                            <h3 class="text-xl font-bold mb-2">Management Card</h3>
                                            <p class="mb-4">You have been designated to receive a management card. Would you like to draw one?</p>

                                            @if (getPlayerManagementCard(authService.userId()!, game)) {
                                                <p class="mb-2 text-yellow-300">
                                                    Note: You already have a {{ getPlayerManagementCard(authService.userId()!, game) }} card.
                                                    Drawing a new card will discard your current one.
                                                </p>
                                            }

                                            <div class="flex gap-4">
                                                <button (click)="gameService.drawManagementCard()"
                                                        class="bg-green-500 hover:bg-green-600 px-4 py-2 rounded">
                                                    Draw Card
                                                </button>
                                                <button (click)="gameService.skipManagementCard()"
                                                        class="bg-red-500 hover:bg-red-600 px-4 py-2 rounded">
                                                    Skip
                                                </button>
                                            </div>
                                        </div>
                                    } @else if (game.managementPhase) {
                                        <!-- Show waiting message to other players when someone is drawing a management card -->
                                        <div class="bg-purple-800 bg-opacity-80 p-4 rounded-lg mb-4">
                                            <h3 class="text-xl font-bold mb-2">Management Card Phase</h3>
                                            <p class="mb-4">{{ game.players[game.managementDesignatedPlayer!].name }} is drawing their management card. Please wait...</p>
                                        </div>
                                    } @else {
                                        <p class="mb-2">Team proposed by {{ game.players[game.currentTO_id!].name }}. Vote:</p>
                                        <div class="mb-4 text-lg">
                                            <!-- Display only the proposed team members -->
                                            Proposed Team: <span class="font-bold">{{ getProposedTeamNames(game) }}</span>

                                            <!-- Voting status now displayed under each player's avatar -->
                                            <p class="mb-2">
                                                Votes Cast: {{ teamVoteCount() }} / {{ game.playerOrder.length }}
                                            </p>

                                            <p class="mb-4">Vote to AGREE or RETHROW.</p>
                                            <button (click)="gameService.submitVote('agree')"
                                                    [disabled]="!!game.teamVote?.votes?.[authService.userId()!]"
                                                    class="bg-green-500 hover:bg-green-600 px-6 py-3 rounded text-lg mr-2 disabled:opacity-50 disabled:cursor-not-allowed">
                                                    AGREE
                                            </button>
                                            <button (click)="gameService.submitVote('rethrow')"
                                                    [disabled]="!!game.teamVote?.votes?.[authService.userId()!]">
                                            </button>
                                            <button (click)="gameService.submitVote('rethrow')" class="bg-red-500 hover:bg-red-600 px-6 py-3 rounded text-lg">RETHROW</button>
                                        </div>
                                    }
                                </div>
                            }
                            @case ('mission') {
                                <div>
                                    <!-- Management Phase UI -->
                                    @if (game.managementPhase && authService.userId() === game.managementDesignatedPlayer) {
                                        <div class="bg-purple-800 bg-opacity-80 p-4 rounded-lg mb-4">
                                            <h3 class="text-xl font-bold mb-2">Management Card</h3>
                                            <p class="mb-4">You have been designated to receive a management card. Would you like to draw one?</p>

                                            @if (getPlayerManagementCard(authService.userId()!, game)) {
                                                <p class="mb-2 text-yellow-300">
                                                    Note: You already have a {{ getPlayerManagementCard(authService.userId()!, game) }} card.
                                                    Drawing a new card will discard your current one.
                                                </p>
                                            }

                                            <div class="flex gap-4">
                                                <button (click)="gameService.drawManagementCard()"
                                                        class="bg-green-500 hover:bg-green-600 px-4 py-2 rounded">
                                                    Draw Card
                                                </button>
                                                <button (click)="gameService.skipManagementCard()"
                                                        class="bg-red-500 hover:bg-red-600 px-4 py-2 rounded">
                                                    Skip
                                                </button>
                                            </div>
                                        </div>
                                    } @else if (game.managementPhase) {
                                        <!-- Show waiting message to other players when someone is drawing a management card -->
                                        <div class="bg-purple-800 bg-opacity-80 p-4 rounded-lg mb-4">
                                            <h3 class="text-xl font-bold mb-2">Management Card Phase</h3>
                                            <p class="mb-4">{{ game.players[game.managementDesignatedPlayer!].name }} is drawing their management card. Please wait...</p>
                                        </div>
                                    }

                                    <p class="mb-2">Team on User Story: <span class="font-bold">{{ getUserStoryTeamNames(game) }}</span></p>

                                    <!-- Management Card Play UI -->
                                    @if (getPlayerManagementCard(authService.userId()!, game)) {
                                        <div class="bg-purple-800 bg-opacity-80 p-4 rounded-lg mb-4">
                                            <h3 class="text-xl font-bold mb-2">Your Management Card</h3>
                                            <div class="flex items-center gap-4">
                                                <img [src]="'assets/management/' + getPlayerManagementCard(authService.userId()!, game) + '.png'"
                                                     alt="Management Card" class="w-16 h-24">
                                                <div>
                                                    <p class="mb-2 font-semibold">{{ MANAGEMENT_CARDS[getPlayerManagementCard(authService.userId()!, game)!]?.title }} - {{ MANAGEMENT_CARDS[getPlayerManagementCard(authService.userId()!, game)!]?.name }}</p>
                                                    <p class="mb-2 text-sm">{{ MANAGEMENT_CARDS[getPlayerManagementCard(authService.userId()!, game)!]?.instructions }}</p>
                                                    <div class="flex gap-2">
                                                        <button (click)="gameService.playManagementCard()"
                                                                class="bg-purple-500 hover:bg-purple-600 px-4 py-2 rounded">
                                                            Play Card
                                                        </button>
                                                        <button (click)="gameService.skipPlayingManagementCard()"
                                                                class="bg-gray-500 hover:bg-gray-600 px-4 py-2 rounded">
                                                            Skip
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    }

                                    @if (isPlayerOnUserStory(game)) {
                                        <p class="mb-4">Play your card (Approve/Request Changes).</p>
                                        <div class="flex gap-4">
                                            <button (click)="gameService.submitMissionCard('approve')"
                                                    [disabled]="!!game.mission?.cardsPlayed?.[authService.userId()!]"
                                                    class="disabled:opacity-50 disabled:cursor-not-allowed">
                                                <img src="assets/review-approvechanges.png" alt="Approve" class="w-24 h-32">
                                            </button>
                                            <button (click)="gameService.submitMissionCard('request')"
                                                    [disabled]="!!game.mission?.cardsPlayed?.[authService.userId()!] || (game.roles && (game.roles[authService.userId()!] === 'LoyalDexter' || game.roles[authService.userId()!] === 'Duke' || game.roles[authService.userId()!] === 'SupportManager'))"
                                                    class="disabled:opacity-50 disabled:cursor-not-allowed">
                                                <img src="assets/review-requestchanges.png" alt="Request Changes" class="w-24 h-32">
                                                @if (game.roles && (game.roles[authService.userId()!] === 'LoyalDexter' || game.roles[authService.userId()!] === 'Duke' || game.roles[authService.userId()!] === 'SupportManager')) {
                                                    <div class="text-xs text-red-300 mt-1">Not allowed for Dexter players</div>
                                                }
                                            </button>
                                        </div>
                                        <p class="mt-4 text-sm">
                                            Cards Played: {{ userStoryCardsPlayedCount() }} / {{ game.mission?.team?.length }}
                                        </p>
                                    } @else {
                                        <p class="mb-4">Waiting for User Story results...</p>
                                    }
                                </div>
                            }
                            @case ('results') {
                                <div>
                                @if (game.storyResults && game.storyResults[(game.currentStoryNum ?? 1) - 1] !== null) {
                                    @if (game.storyResults[(game.currentStoryNum ?? 1) - 1] === 'dexter') {
                                        <p class="text-xl font-bold text-green-400 mb-4">User Story OD-{{ (game.currentStoryNum ?? 1) }} Succeeded!</p>
                                    } @else if (game.storyResults[(game.currentStoryNum ?? 1) - 1] === 'sinister') {
                                        <p class="text-xl font-bold text-red-400 mb-4">User Story OD-{{ (game.currentStoryNum ?? 1) }} Failed!</p>
                                    }
                                } @else {
                                    <p class="mb-2">Processing results...</p>
                                }

                                <button (click)="nextRound()" class="bg-blue-500 hover:bg-blue-600 px-4 py-2 rounded">Next Round</button>
                                </div>
                            }
                            @case ('assassination') {
                                <div>
                                    @if (authService.userId() === game.assassination?.sniperId) {
                                        <h3 class="text-xl font-bold mb-4">You are the Sniper!</h3>
                                        <p class="mb-4">Dexter has won more stories, but you have one last chance to win the game for Sinister.</p>
                                        <p class="mb-4 text-yellow-300">Select a Dexter player who you think is the Duke. If you're correct, Sinister wins!</p>

                                        <div class="flex flex-wrap gap-2 mb-4">
                                            @for (playerId of game.playerOrder; track playerId) {
                                                @if (game.roles && game.roles[playerId] !== 'SinisterSpy' && game.roles[playerId] !== 'Sniper' && game.roles[playerId] !== 'Nerlin' && game.roles[playerId] !== 'DevSlayer') {
                                                    <button class="px-3 py-1 rounded"
                                                            [ngClass]="{'bg-red-500 text-white': selectedPlayers.includes(playerId), 'bg-gray-300 text-black': !selectedPlayers.includes(playerId)}"
                                                            (click)="togglePlayerSelection(playerId, game)">
                                                            {{ game.players[playerId]?.name }}
                                                    </button>
                                                }
                                            }
                                        </div>

                                        <button (click)="submitAssassination(game)"
                                                [disabled]="selectedPlayers.length !== 1"
                                                class="bg-red-500 hover:bg-red-600 px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed">
                                                Assassinate
                                        </button>
                                    } @else {
                                        <h3 class="text-xl font-bold mb-4">Assassination Phase</h3>
                                        <p class="mb-4">Dexter has won more stories, but the Sniper gets one last chance to win the game for Sinister.</p>
                                        <p class="mb-4">Waiting for {{ game.players[game.assassination?.sniperId!]?.name }} (Sniper) to select a target...</p>
                                    }
                                </div>
                            }
                            @case ('gameOver') {
                                <div>
                                    <h3 class="text-3xl font-bold mb-2">{{ game.winner }} Wins!</h3>
                                    <button (click)="gameService.leaveGame()" class="bg-gray-500 px-4 py-2 rounded">Back to Dashboard</button>
                                </div>
                            }
                            @case ('loyaltyReveal') {
                                <div>
                                    @if (authService.userId() === game.loyaltyRevealPlayerId) {
                                        <h3 class="text-xl font-bold mb-4">Select a player to reveal your loyalty to:</h3>
                                        <div class="flex flex-wrap gap-2 mb-4">
                                            @for (playerId of game.playerOrder; track playerId) {
                                                @if (playerId !== authService.userId()) {
                                                    <button class="px-3 py-1 rounded bg-purple-500 hover:bg-purple-600 text-white"
                                                            (click)="revealLoyaltyToPlayer(playerId, game)">
                                                        {{ game.players[playerId]?.name }}
                                                    </button>
                                                }
                                            }
                                        </div>
                                    } @else {
                                        <p class="mb-4">Waiting for {{ game.players[game.loyaltyRevealPlayerId!]?.name }} to select a player to reveal their loyalty to...</p>
                                    }
                                </div>
                            }
                            @case ('ceoCardPlay') {
                                <div>
                                    @if (authService.userId() === game.ceoCardPlayerId) {
                                        <h3 class="text-xl font-bold mb-4">CEO Card: The Real Boss!</h3>

                                        <!-- If there are players with management cards -->
                                        @if (playersWithManagementCards(game).length > 0) {
                                            <p class="mb-4">Select a player to take their management card:</p>
                                            <div class="flex flex-wrap gap-2 mb-4">
                                                @for (playerId of playersWithManagementCards(game); track playerId) {
                                                    <button class="px-3 py-1 rounded bg-purple-500 hover:bg-purple-600 text-white"
                                                            (click)="takeManagementCard(playerId, game)">
                                                        {{ game.players[playerId]?.name }} ({{ MANAGEMENT_CARDS[game.players[playerId].managementCard!]?.title }})
                                                    </button>
                                                }
                                            </div>
                                        }
                                        @else if (game.ceoCardDrawnCards && game.ceoCardDrawnCards.length > 0) {
                                            <p class="mb-4">No other players have management cards. Select one of these cards to keep:</p>
                                            <div class="flex flex-wrap gap-4 mb-4">
                                                @for (cardId of game.ceoCardDrawnCards; track cardId) {
                                                    <div class="flex flex-col items-center">
                                                        <img [src]="'assets/management/' + cardId + '.png'"
                                                             alt="Management Card" class="w-24 h-36 mb-2">
                                                        <p class="text-sm font-semibold">{{ MANAGEMENT_CARDS[cardId]?.title }} - {{ MANAGEMENT_CARDS[cardId]?.name }}</p>
                                                        <button class="mt-2 px-3 py-1 rounded bg-green-500 hover:bg-green-600 text-white"
                                                                (click)="selectCEOCard(cardId, game)">
                                                            Select
                                                        </button>
                                                    </div>
                                                }
                                            </div>
                                        }
                                        @else {
                                            <p class="mb-4">No other players have management cards. Drawing two cards for you to choose from...</p>
                                            <button (click)="drawCEOCards(game)"
                                                    class="bg-purple-500 hover:bg-purple-600 px-4 py-2 rounded">
                                                Draw Cards
                                            </button>
                                        }
                                    } @else {
                                        <p class="mb-4">Waiting for {{ game.players[game.ceoCardPlayerId!]?.name }} to use their CEO card...</p>
                                    }
                                </div>
                            }
                            @case ('scopeCreep') {
                                <div>
                                    {{ initializeSelectedPlayers(game) }}
                                    @if (authService.userId() === game.scopeCreepPlayerId) {
                                        <p class="mb-2">
                                            You played the CMO Scope Creep card!
                                            <strong class="text-yellow-300">You must add an additional person to the development team.</strong>
                                        </p>
                                        <p class="mb-2">
                                            Current team: <span class="font-bold">{{ getUserStoryTeamNames(game) }}</span>
                                        </p>

                                        <!-- Instructions based on selection state -->
                                        @if (this.selectedPlayers.length === 0) {
                                            <p class="text-yellow-300 mb-2">Select a player NOT on the team to add:</p>
                                        } @else if (this.selectedPlayers.length === 1) {
                                            <p class="mb-2">Player to add: <span class="font-bold">{{ game.players[this.selectedPlayers[0]]?.name }}</span></p>
                                        }

                                        <div class="flex flex-wrap gap-2 mb-4">
                                            @for (playerId of game.playerOrder; track playerId) {
                                                <!-- Only show players not already on the team -->
                                                @if (!game.mission?.team?.includes(playerId)) {
                                                    <button class="px-3 py-1 rounded"
                                                            [ngClass]="{
                                                                'bg-blue-500 text-white': selectedPlayers.includes(playerId),
                                                                'bg-gray-300 text-black': !selectedPlayers.includes(playerId),
                                                                'border-2 border-green-500': selectedPlayers[0] === playerId
                                                            }"
                                                            (click)="togglePlayerSelection(playerId, game)">
                                                            {{ game.players[playerId]?.name }}
                                                            @if (selectedPlayers.includes(playerId)) {
                                                                <span class="text-xs">+</span>
                                                            }
                                                    </button>
                                                }
                                            }
                                        </div>

                                        <button (click)="submitScopeCreepTeam(game)"
                                                [disabled]="selectedPlayers.length !== 1"
                                                class="bg-green-500 hover:bg-green-600 px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed">
                                                Add Player
                                        </button>
                                    } @else {
                                        <p class="mb-2">
                                            {{ game.players[game.scopeCreepPlayerId!].name }} played the CMO Scope Creep card!
                                        </p>
                                        <p class="mb-2">
                                            <strong class="text-yellow-300">They are selecting an additional player to add to the development team.</strong>
                                        </p>
                                        <p class="mb-2">
                                            Current team: <span class="font-bold">{{ getUserStoryTeamNames(game) }}</span>
                                        </p>
                                    }
                                </div>
                            }
                            @case ('serviceReassignment') {
                                <div>
                                    {{ initializeSelectedPlayers(game) }}
                                    @if (authService.userId() === game.serviceReassignmentPlayerId) {
                                        <p class="mb-2">
                                            You played the VP R&D Service Reassignment card!
                                            <strong class="text-yellow-300">You must exchange a player on the development team with a player not on the team.</strong>
                                        </p>
                                        <p class="mb-2">
                                            Current team: <span class="font-bold">{{ getUserStoryTeamNames(game) }}</span>
                                        </p>

                                        <!-- Instructions based on selection state -->
                                        @if (this.selectedPlayers.length === 0) {
                                            <p class="text-yellow-300 mb-2">First, select a player ON the team to remove:</p>
                                        } @else if (this.selectedPlayers.length === 1) {
                                            <p class="text-yellow-300 mb-2">Now, select a player NOT on the team to add:</p>
                                            <p class="mb-2">Player to remove: <span class="font-bold">{{ game.players[this.selectedPlayers[0]]?.name }}</span></p>
                                        } @else if (this.selectedPlayers.length === 2) {
                                            <p class="mb-2">Player to remove: <span class="font-bold">{{ game.players[this.selectedPlayers[0]]?.name }}</span></p>
                                            <p class="mb-2">Player to add: <span class="font-bold">{{ game.players[this.selectedPlayers[1]]?.name }}</span></p>
                                        }

                                        <div class="flex flex-wrap gap-2 mb-4">
                                            @for (playerId of game.playerOrder; track playerId) {
                                                <button class="px-3 py-1 rounded"
                                                        [ngClass]="{
                                                            'bg-blue-500 text-white': selectedPlayers.includes(playerId),
                                                            'bg-gray-300 text-black': !selectedPlayers.includes(playerId),
                                                            'border-2 border-red-500': selectedPlayers[0] === playerId,
                                                            'border-2 border-green-500': selectedPlayers[1] === playerId
                                                        }"
                                                        (click)="togglePlayerSelection(playerId, game)">
                                                        {{ game.players[playerId]?.name }}
                                                        @if (isPlayerOnUserStory(game) && playerId === selectedPlayers[0]) {
                                                            <span class="text-xs">-</span>
                                                        } @else if (!isPlayerOnUserStory(game) && playerId === selectedPlayers[1]) {
                                                            <span class="text-xs">+</span>
                                                        }
                                                </button>
                                            }
                                        </div>

                                        <button (click)="submitServiceReassignment(game)"
                                                [disabled]="selectedPlayers.length !== 2"
                                                class="bg-green-500 hover:bg-green-600 px-4 py-2 rounded disabled:opacity-50 disabled:cursor-not-allowed">
                                                Confirm Exchange
                                        </button>
                                    } @else {
                                        <p class="mb-2">
                                            {{ game.players[game.serviceReassignmentPlayerId!].name }} played the VP R&D Service Reassignment card!
                                        </p>
                                        <p class="mb-2">
                                            <strong class="text-yellow-300">They are selecting a player to exchange on the development team.</strong>
                                        </p>
                                        <p class="mb-2">
                                            Current team: <span class="font-bold">{{ getUserStoryTeamNames(game) }}</span>
                                        </p>
                                    }
                                </div>
                            }
                            @default {
                                <p>Waiting for game to progress...</p>
                            }
                        }
                    </div>

                    <!-- Played Management Card Section -->
                    @if (getPlayedManagementCard(game)) {
                        <div class="bg-purple-800 bg-opacity-80 p-4 rounded-lg mt-4 mb-4">
                            <h3 class="text-xl font-bold mb-2">Active Management Card</h3>
                            <div class="flex flex-col md:flex-row gap-4">
                                <div class="flex-shrink-0">
                                    <img [src]="getPlayedManagementCard(game)?.imageUrl"
                                         alt="Management Card" class="w-[12rem] h-[8rem]">
                                </div>
                                <div class="flex-grow">
                                    <h4 class="text-lg font-semibold">{{ getPlayedManagementCard(game)?.title }} - {{ getPlayedManagementCard(game)?.name }}</h4>
                                    <p class="text-sm mb-2">Played by {{ getPlayedManagementCard(game)?.playedBy }}</p>
                                    <p class="text-sm">{{ getPlayedManagementCard(game)?.instructions }}</p>
                                </div>
                            </div>
                        </div>
                    }

                    <div class="grid md:grid-cols-3 gap-4 mt-4">
                        <div class="bg-slate-700 bg-opacity-90 p-3 rounded">
                            <h4 class="font-semibold border-b border-slate-600 pb-1 mb-1 text-sm">Your Role: <span class="text-cyan-300">{{myRole()}}</span></h4>
                            <p class="text-xs text-gray-300">{{getRoleDescription(myRole())}}</p>
                        </div>

                        <!-- User's Management Card (Always Visible) -->
                        <div class="bg-slate-700 bg-opacity-90 p-3 rounded">
                            <h4 class="font-semibold border-b border-slate-600 pb-1 mb-1 text-sm">Your Management Card</h4>
                            @if (getPlayerManagementCard(authService.userId()!, game)) {
                                <div class="flex items-center gap-2">
                                    <img [src]="'assets/management/' + getPlayerManagementCard(authService.userId()!, game) + '.png'"
                                         alt="Management Card" class="w-12 h-18">
                                    <div>
                                        <p class="text-xs font-semibold">{{ MANAGEMENT_CARDS[getPlayerManagementCard(authService.userId()!, game)!]?.title }} - {{ MANAGEMENT_CARDS[getPlayerManagementCard(authService.userId()!, game)!]?.name }}</p>
                                        <p class="text-xs text-gray-300">{{ MANAGEMENT_CARDS[getPlayerManagementCard(authService.userId()!, game)!]?.instructions }}</p>
                                    </div>
                                </div>
                            } @else {
                                <p class="text-xs text-gray-300">You don't have a management card yet.</p>
                            }
                        </div>

                        <div class="bg-slate-700 bg-opacity-90 p-3 rounded">
                            <h4 class="font-semibold border-b border-slate-600 pb-1 mb-1 text-sm">Game Log</h4>
                            <div class="h-40 overflow-y-auto text-xs bg-slate-800 p-2 rounded">
                                @if (game.gameLog && game.gameLog.length > 0) {
                                    @for (logEntry of getRecentGameLogs(game); track $index) {
                                        <div class="mb-1 pb-1 border-b border-slate-700">
                                            <span>{{ logEntry.message }}</span>
                                        </div>
                                    }
                                } @else {
                                    <div class="text-gray-400 italic">No game logs yet.</div>
                                }
                            </div>
                        </div>
                    </div>
                </div>
            } @else {
                <div class="text-center p-8">Loading game...</div>
            }

            <!-- Sidebar for Cards & Roles -->
            @if (gameService.currentGame(); as game) {
                <div class="fixed top-0 right-0 h-full bg-slate-900 bg-opacity-95 shadow-lg z-30 overflow-y-auto transition-all duration-300"
                     [ngClass]="{'w-80': showSidebar, 'w-0': !showSidebar}">
                    <div class="p-4 mt-16">
                        <!-- User's Management Card Section -->
                        @if (getPlayerManagementCard(authService.userId()!, game)) {
                            <div class="bg-purple-800 bg-opacity-80 p-4 rounded-lg mb-4">
                                <h3 class="text-xl font-bold mb-2">Your Management Card</h3>
                                <div class="flex items-center gap-4">
                                    <img [src]="'assets/management/' + getPlayerManagementCard(authService.userId()!, game) + '.png'"
                                         alt="Management Card" class="w-16 h-24">
                                    <div>
                                        <p class="mb-2">{{ MANAGEMENT_CARDS[getPlayerManagementCard(authService.userId()!, game)!]?.title }} - {{ MANAGEMENT_CARDS[getPlayerManagementCard(authService.userId()!, game)!]?.name }}</p>
                                        <p class="text-xs">{{ MANAGEMENT_CARDS[getPlayerManagementCard(authService.userId()!, game)!]?.instructions }}</p>
                                    </div>
                                </div>
                            </div>
                        }

                        <!-- All Management Cards Section -->
                        <div class="mb-4">
                            <h3 class="text-xl font-bold mb-2 border-b border-gray-700 pb-2">Management Cards</h3>
                            <p class="mb-2 text-sm">Cards left in deck: <span class="font-bold">{{ game.managementDeck?.length || 0 }}</span></p>
                            @for (cardId of getAllManagementCardIds(); track cardId) {
                                <div class="bg-slate-800 p-3 rounded-lg mb-2">
                                    <div class="flex items-start gap-2">
                                        <img [src]="'assets/management/' + cardId + '.png'"
                                             alt="Management Card" class="w-12 h-18 flex-shrink-0">
                                        <div>
                                            <h4 class="font-semibold">{{ MANAGEMENT_CARDS[cardId]?.title }} - {{ MANAGEMENT_CARDS[cardId]?.name }}</h4>
                                            <p class="text-xs text-gray-300">{{ MANAGEMENT_CARDS[cardId]?.instructions }}</p>
                                        </div>
                                    </div>
                                </div>
                            }
                        </div>

                        <!-- Discarded Management Cards Section -->
                        @if (game.discardedManagementCards && game.discardedManagementCards.length > 0) {
                            <div class="mb-4">
                                <h3 class="text-xl font-bold mb-2 border-b border-gray-700 pb-2">Discarded Management Cards</h3>
                                @for (card of game.discardedManagementCards; track $index) {
                                    <div class="bg-slate-800 p-3 rounded-lg mb-2">
                                        <div class="flex items-start gap-2">
                                            <img [src]="'assets/management/' + card.cardId + '.png'"
                                                 alt="Discarded Card" class="w-12 h-18 flex-shrink-0">
                                            <div>
                                                <h4 class="font-semibold">{{ MANAGEMENT_CARDS[card.cardId]?.title }} - {{ MANAGEMENT_CARDS[card.cardId]?.name }}</h4>
                                                <p class="text-xs text-gray-300">Played by {{ game.players[card.playedBy].name || 'Unknown' }}</p>
                                            </div>
                                        </div>
                                    </div>
                                }
                            </div>
                        }

                        <!-- All Roles Section -->
                        <div>
                            <h3 class="text-xl font-bold mb-2 border-b border-gray-700 pb-2">Roles in Game</h3>
                            <div class="grid grid-cols-1 gap-2">
                                @for (role of getActiveRoles(game); track role) {
                                    <div class="bg-slate-800 p-3 rounded-lg">
                                        <h4 class="font-semibold">{{ role }}</h4>
                                        <p class="text-xs text-gray-300">{{ getRoleDescription(role) }}</p>
                                    </div>
                                }
                            </div>
                        </div>
                    </div>
                </div>
            }
        </div>
    `,
    imports: [CommonModule, FormsModule]
})
export class GameBoardComponent {
    authService = inject(AuthService);
    gameService = inject(GameService);
    MANAGEMENT_CARDS = MANAGEMENT_CARDS; // Make MANAGEMENT_CARDS accessible in the template

    selectedPlayers: string[] = []; // Array to hold selected player IDs for team proposal
    managementDesignatedPlayer: string | null = null; // Player ID designated to receive a management card
    showSidebar: boolean = false; // Controls visibility of the cards & roles sidebar

    // Initialize selectedPlayers with the original team members for Shifting Priorities
    initializeSelectedPlayers(game: Game): void {
        if (game.status === 'shiftingPriorities' && game.teamProposal?.selectedPlayers) {
            this.selectedPlayers = [...game.teamProposal.selectedPlayers];
            console.log("Initialized selectedPlayers with original team:", this.selectedPlayers);
        }
    }

    // Toggle sidebar visibility
    toggleSidebar(): void {
        this.showSidebar = !this.showSidebar;
    }

    // Get all management card IDs
    getAllManagementCardIds(): string[] {
        return Object.keys(MANAGEMENT_CARDS);
    }

    // Get recent game logs (most recent first)
    getRecentGameLogs(game: Game): { timestamp: any, message: string }[] {
        if (!game.gameLog || game.gameLog.length === 0) return [];

        // Return a copy of the game log array in reverse order (newest first)
        return [...game.gameLog].reverse().slice(0, 20); // Show last 20 log entries
    }

    // Format timestamp for display
    formatTimestamp(timestamp: any): string {
        if (!timestamp) return '';

        // Handle both Date objects and Firestore Timestamps
        const date = timestamp instanceof Date ? timestamp : timestamp.toDate();

        // Format as HH:MM:SS
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    // Get all active roles in the game
    getActiveRoles(game: Game): string[] {
        if (!game.roles) return [];

        // Get unique roles from the game
        const uniqueRoles = new Set<string>();
        Object.values(game.roles).forEach(role => {
            if (role) uniqueRoles.add(role);
        });

        return Array.from(uniqueRoles);
    }

    myRole = computed(() => {
        const game = this.gameService.currentGame();
        const myId = this.authService.userId();
        if (game && myId && game.roles && game.roles[myId]) {
            return game.roles[myId];
        }
        return 'Unknown';
    });

    teamVoteCount = computed(() => {
        const game = this.gameService.currentGame();
        if (game?.teamVote?.votes) {
            return Object.keys(game.teamVote.votes).length;
        }
        return 0;
    });

    userStoryCardsPlayedCount = computed(() => {
        const game = this.gameService.currentGame();
        if (game?.mission?.cardsPlayed) {
            return Object.keys(game.mission.cardsPlayed).length;
        }
        return 0;
    });

    getPlayerColor(playerId: string): string {
        const game = this.gameService.currentGame();
        const myId = this.authService.userId();

        if (game && myId && game.roles) {
            const myRole = game.roles[myId];
            const playerRole = game.roles[playerId];

            // Duke can see all Sinister team members except Nerlin
            if (myRole === 'Duke' &&
                (playerRole === 'Sniper' || playerRole === 'SinisterSpy' || playerRole === 'DevSlayer')) {
                return 'FF0000'; // Red color for Sinister team members when viewed by Duke
            }

            // Support Manager can see the Duke
            if (myRole === 'SupportManager' && playerRole === 'Duke') {
                return '4B0082'; // Indigo color for Duke when viewed by Support Manager
            }

            // Support Manager sees Dev Slayer as Duke
            if (myRole === 'SupportManager' && playerRole === 'DevSlayer') {
                return '4B0082'; // Same color as Duke for Dev Slayer when viewed by Support Manager
            }

            // Sinister Spies can see other Sinister Spies
            if ((myRole === 'Sniper' || myRole === 'SinisterSpy' || myRole === 'Nerlin' || myRole === 'DevSlayer') &&
                (playerRole === 'Sniper' || playerRole === 'SinisterSpy' || playerRole === 'Nerlin' || playerRole === 'DevSlayer') &&
                myId !== playerId) {
                return 'FF0000'; // Red color for Sinister team members when viewed by other Sinister Spies
            }
        }

        // Default color generation for other cases
        let hash = 0;
        for (let i = 0; i < playerId.length; i++) {
            hash = playerId.charCodeAt(i) + ((hash << 5) - hash);
            hash = hash & hash;
        }
        const color = Math.abs(hash).toString(16).substring(0, 6);
        return "000000".substring(0, 6 - color.length) + color;
    }


    getPhaseTitle(status: Game['status'] | undefined): string {
        if (!status) return 'Loading...';
        switch(status) {
            case 'teamProposal': return 'Team Proposal';
            case 'teamVoting': return 'Team Vote';
            case 'mission': return 'Review';
            case 'results': return 'Results';
            case 'gameOver': return 'Game Over';
            case 'shiftingPriorities': return 'Shifting Priorities - Team Selection';
            case 'ceoCardPlay': return 'CEO Card: The Real Boss!';
            case 'assassination': return 'Assassination - Sniper\'s Turn';
            default: return status.charAt(0).toUpperCase() + status.slice(1);
        }
    }

    getNumToSelect(game: Game): number {
        const playerCount = game.playerOrder.length;
        const storyNum = game.currentStoryNum || 1;
        // Based on "manual (1).pdf" page 6 (5 User Story Team Size)
        // Players:       5  6  7  8  9 10
        // 1st User Story: 2  2  2  3  3  3
        // 2nd User Story: 3  3  3  4  4  4
        // 3rd User Story: 2  4  3  4  4  4  (Note: 6p/3rd is 4, not 3 as in some games)
        // 4th User Story: 3  3  4  5  5  5  (* requires 2 fails for 7+ players)
        // 5th User Story: 3  4  4  5  5  5
        const teamSizes: {[key: number]: number[]} = {
             5: [2,3,2,3,3],
             6: [2,3,4,3,4], // Corrected 6p/3rd to 4
             7: [2,3,3,4,4], // Avalon has 2,3,3,4*,4 for 7p. Sprint has 2,3,3,4*,4.
             8: [3,4,4,5,5],
             9: [3,4,4,5,5],
            10: [3,4,4,5,5],
            11: [3,4,5,5,5], // Assuming similar pattern for 11,12 or use 7-story chart
            12: [3,4,5,5,5],
        };
        return (teamSizes[playerCount] && teamSizes[playerCount][storyNum - 1]) || 2;
    }

    getProposedTeamNames(game: Game): string {
        if (!game.teamVote?.proposedTeam) return 'N/A';
        return game.teamVote.proposedTeam.map(id => game.players[id]?.name || 'Unknown').join(', ');
    }

    getOriginalTeamNames(game: Game): string {
        if (!game.teamProposal?.selectedPlayers || game.teamProposal.selectedPlayers.length === 0) return 'N/A';
        return game.teamProposal.selectedPlayers.map(id => game.players[id]?.name || 'Unknown').join(', ');
    }

    isOriginalTeamMember(playerId: string, game: Game): boolean {
        if (!game.teamProposal?.selectedPlayers) return false;
        return game.teamProposal.selectedPlayers.includes(playerId);
    }

    getUserStoryTeamNames(game: Game): string {
        if (!game.mission?.team) return 'N/A';
        return game.mission.team.map(id => game.players[id]?.name || 'Unknown').join(', ');
    }

    getCompletedMissionTeamNames(game: Game, storyIndex: number): string {
        if (!game.completedMissionTeams || !game.completedMissionTeams[storyIndex]) return 'No data available';
        return game.completedMissionTeams[storyIndex].map(id => game.players[id]?.name || 'Unknown').join(', ');
    }

    getMissionHistoryInfo(game: Game, storyIndex: number): string {
        if (!game.storyResults || game.storyResults[storyIndex] === null) return 'Not completed yet';

        let info = 'Team: ' + this.getCompletedMissionTeamNames(game, storyIndex);

        // Add TO who proposed the team
        if (game.missionHistory && game.missionHistory[storyIndex] && game.missionHistory[storyIndex].acceptedTeamProposedBy) {
            const toId = game.missionHistory[storyIndex].acceptedTeamProposedBy;
            const toName = game.players[toId]?.name || 'Unknown TO';
            info += '\nProposed by: ' + toName;
        }

        // Add request changes count if the mission failed
        if (game.storyResults[storyIndex] === 'sinister' && game.missionHistory && game.missionHistory[storyIndex]) {
            const requestCount = game.missionHistory[storyIndex].requestChangesCount;
            info += '\nRequest Changes: ' + requestCount;
        }

        return info;
    }

    isPlayerOnUserStory(game: Game): boolean {
        const myId = this.authService.userId();
        return !!(myId && game.mission?.team?.includes(myId));
    }

    getRoleDescription(role: string): string {
        if (role === 'Duke') return "You know Sinister. Guide Dexter. Must Approve.";
        if (role === 'Sniper') return "Sinister. If Dexter wins, you can snipe the Duke.";
        if (role === 'SinisterSpy') return "Sinister. Cause User Stories to fail. Can Approve/Request.";
        if (role === 'LoyalDexter') return "Dexter. Help User Stories succeed. Must Approve.";
        if (role === 'SupportManager') return "Dexter. You can see who the Duke is (highlighted with indigo border and labeled). Protect the Duke's identity.";
        if (role === 'Nerlin') return "Sinister. Your identity is hidden from the Duke.";
        if (role === 'DevSlayer') return "Sinister. You appear as the Duke to the Support Manager.";
        return "Your objective will be revealed.";
    }

    proposeTeam(game: Game): void {
        console.log("Propose Team clicked");
        // Convert selectedPlayers IDs to Player objects
        const selectedTeam = this.selectedPlayers.map(playerId => game.players[playerId]);
        this.gameService.proposeTeam(selectedTeam, undefined, this.managementDesignatedPlayer || undefined);
    }

    submitShiftingPrioritiesTeam(game: Game): void {
        console.log("Submit Shifting Priorities Team clicked");
        this.gameService.submitShiftingPrioritiesTeam(this.selectedPlayers, undefined);
    }

    submitScopeCreepTeam(game: Game): void {
        console.log("Submit Scope Creep Team clicked");
        // Call the game service to submit the additional player for Scope Creep
        if (this.selectedPlayers.length === 1) {
            this.gameService.submitScopeCreepTeam(this.selectedPlayers[0]);
        }
    }

    submitServiceReassignment(game: Game): void {
        // Call the game service to submit the service reassignment
        if (this.selectedPlayers.length === 2) {
            this.gameService.submitServiceReassignment(this.selectedPlayers[0], this.selectedPlayers[1]);
        }
    }

    toggleManagementDesignation(playerId: string): void {
        // If the player is already designated, undesignate them
        if (this.managementDesignatedPlayer === playerId) {
            this.managementDesignatedPlayer = null;
        } else {
            // Otherwise, designate them
            this.managementDesignatedPlayer = playerId;
        }
    }

    revealLoyaltyToPlayer(playerId: string, game: Game): void {
        // Call the game service to reveal loyalty to the selected player
        this.gameService.revealLoyaltyToPlayer(playerId);
    }

    togglePlayerSelection(playerId: string, game: Game): void {
        // For Shifting Priorities, we need to handle team selection differently
        if (game.status === 'shiftingPriorities') {
            const numToSelect = game.teamProposal?.numToSelect || 0;
            const originalTeam = game.teamProposal?.selectedPlayers || [];

            // If player is already selected, only allow removal if they're not part of the original team
            if (this.selectedPlayers.includes(playerId)) {
                // Don't allow removing players from the original team
                if (originalTeam.includes(playerId)) {
                    console.log("Cannot remove player from original team during Shifting Priorities");
                    return;
                }
                this.selectedPlayers = this.selectedPlayers.filter(id => id !== playerId);
            }
            // If player is not selected and we haven't reached the limit, add them
            else if (this.selectedPlayers.length < numToSelect) {
                this.selectedPlayers.push(playerId);
            }
            // If we've reached the limit, replace the last non-original team member
            else {
                // Find players who are not in the original team
                const nonOriginalPlayers = this.selectedPlayers.filter(id => !originalTeam.includes(id));

                if (nonOriginalPlayers.length > 0) {
                    // Remove the last non-original player
                    const lastNonOriginal = nonOriginalPlayers[nonOriginalPlayers.length - 1];
                    this.selectedPlayers = this.selectedPlayers.filter(id => id !== lastNonOriginal);
                    this.selectedPlayers.push(playerId); // Add the new player
                } else {
                    console.log("Cannot add more players, team is full and all members are from the original team");
                }
            }
        } else if (game.status === 'serviceReassignment') {
            // For Service Reassignment, we need to handle player selection differently
            const missionTeam = game.mission?.team || [];

            // First selection must be a player on the team (to remove)
            if (this.selectedPlayers.length === 0) {
                // Only allow selecting players on the team
                if (!missionTeam.includes(playerId)) {
                    console.log("First selection must be a player on the team to remove");
                    return;
                }
                this.selectedPlayers.push(playerId);
            }
            // Second selection must be a player not on the team (to add)
            else if (this.selectedPlayers.length === 1) {
                // Only allow selecting players not on the team
                if (missionTeam.includes(playerId)) {
                    console.log("Second selection must be a player not on the team to add");
                    return;
                }
                this.selectedPlayers.push(playerId);
            }
            // If both players are already selected, replace the appropriate one
            else if (this.selectedPlayers.length === 2) {
                // If selecting a player on the team, replace the first selection (player to remove)
                if (missionTeam.includes(playerId)) {
                    this.selectedPlayers[0] = playerId;
                }
                // If selecting a player not on the team, replace the second selection (player to add)
                else {
                    this.selectedPlayers[1] = playerId;
                }
            }
        } else if (game.status === 'assassination') {
            // For Assassination phase, we need to handle player selection differently
            const myId = this.authService.userId();

            // Only the Sniper can select a target
            if (!game.assassination || game.assassination.sniperId !== myId) {
                console.log("Only the Sniper can select a target during the Assassination phase");
                return;
            }

            // Check if the player is on the Dexter team
            const playerRole = game.roles?.[playerId];
            if (playerRole && (playerRole === 'SinisterSpy' || playerRole === 'Sniper' || playerRole === 'Nerlin' || playerRole === 'DevSlayer')) {
                console.log("Cannot select a Sinister player as the assassination target");
                return;
            }

            // Clear any previous selection and select the new target
            this.selectedPlayers = [playerId];
        } else {
            // Regular team proposal logic
            const numToSelect = this.getNumToSelect(game);

            // If player is already selected, remove them
            if (this.selectedPlayers.includes(playerId)) {
                this.selectedPlayers = this.selectedPlayers.filter(id => id !== playerId);
            }
            // If player is not selected and we haven't reached the limit, add them
            else if (this.selectedPlayers.length < numToSelect) {
                this.selectedPlayers.push(playerId);
            }
            // If we've reached the limit, replace the first selected player
            else {
                this.selectedPlayers.shift(); // Remove the first player
                this.selectedPlayers.push(playerId); // Add the new player
            }
        }
    }

    nextRound(): void {
        this.gameService.nextRound();
    }

    submitAssassination(game: Game): void {
        console.log("Submit Assassination clicked");
        if (this.selectedPlayers.length !== 1) {
            console.log("Must select exactly one target for assassination");
            return;
        }
        this.gameService.submitAssassination(this.selectedPlayers[0]);
    }

    isPlayerDukeForSupportManager(playerId: string, game: Game): boolean {
        const myId = this.authService.userId();

        if (game.roles && myId && game.roles[myId]) {
            const myRole = game.roles[myId];
            const playerRole = game.roles[playerId];

            // Check if current player is Support Manager and target is Duke or Dev Slayer
            if (myRole === 'SupportManager' && (playerRole === 'Duke' || playerRole === 'DevSlayer')) {
                return true;
            }
        }

        return false;
    }

    getPlayerAvatarUrl(playerId: string, game: Game): string {
        const myId = this.authService.userId();

        // If this is the current player's avatar, show their own image based on their role
        if (playerId === myId && game.roles && myId && game.roles[myId]) {
            const myRole = game.roles[myId];

            // Return appropriate image based on role
            if (myRole === 'Duke') {
                return "assets/the_duke.png";
            } else if (myRole === 'SupportManager') {
                return "assets/support_manager.png";
            } else if (myRole === 'Nerlin') {
                return "assets/nerlin.png";
            } else if (myRole === 'DevSlayer') {
                return "assets/dev_slayer.png";
            } else if (myRole === 'Sniper') {
                return "assets/sniper.png";
            } else if (myRole === 'SinisterSpy') {
                return "assets/sinister.png";
            } else if (myRole === 'LoyalDexter') {
                return "assets/dexter.png"; // Changed from technicalowner.png to dexter.png
            } else {
                // Default for any other roles
                return "assets/dexter.png";
            }
        }

        // Check if this player has revealed their loyalty to the current player via HR card
        if (this.hasLoyaltyBeenRevealed(playerId, game)) {
            const squadLoyalty = this.getPlayerSquadLoyalty(playerId, game);
            if (squadLoyalty === 'dexter') {
                return "assets/dexter.png";
            } else if (squadLoyalty === 'sinister') {
                return "assets/sinister.png";
            }
        }

        // For other players' avatars
        if (game.roles && myId && game.roles[myId]) {
            const myRole = game.roles[myId];
            const playerRole = game.roles[playerId];

            // Duke sees Sinister players (except Nerlin) as sinister.png
            if (myRole === 'Duke') {
                if (playerRole === 'SinisterSpy' || playerRole === 'DevSlayer' || playerRole === 'Sniper') {
                    return "assets/sinister.png";
                }
                // Nerlin remains hidden from Duke and appears as dexter.png
            }

            // Support Manager sees Dev Slayer as Duke
            if (myRole === 'SupportManager' && playerRole === 'DevSlayer') {
                return "assets/the_duke.png";
            }

            // Support Manager sees Duke as Duke
            if (myRole === 'SupportManager' && playerRole === 'Duke') {
                return "assets/the_duke.png";
            }

            // Sinister players can see other Sinister players as sinister.png
            if ((myRole === 'SinisterSpy' || myRole === 'DevSlayer' || myRole === 'Sniper') && playerRole === 'Nerlin') {
                return "assets/sinister.png"; // SinisterSpy, DevSlayer, and Sniper can see Nerlin as sinister.png
            }

            // All Sinister players can see other Sinister players as sinister.png
            if ((myRole === 'SinisterSpy' || myRole === 'DevSlayer' || myRole === 'Nerlin' || myRole === 'Sniper') &&
                (playerRole === 'SinisterSpy' || playerRole === 'DevSlayer' || playerRole === 'Nerlin' || playerRole === 'Sniper')) {
                return "assets/sinister.png";
            }
        }

        // For all other players, show dexter.png
        return "assets/dexter.png";
    }

    // Get the management card for a player
    getPlayerManagementCard(playerId: string, game: Game): string | null {
        if (!game.players[playerId]) {
            return null;
        }

        return game.players[playerId].managementCard || null;
    }

    // Get the details of the played management card
    getPlayedManagementCard(game: Game) {
        if (!game.playedManagementCard || !game.playedManagementCard.cardId) {
            return null;
        }

        const cardId = game.playedManagementCard.cardId;
        const cardInfo = MANAGEMENT_CARDS[cardId];

        if (!cardInfo) {
            return null;
        }

        return {
            ...cardInfo,
            playedBy: game.players[game.playedManagementCard.playedBy]?.name || 'Unknown',
            playedAt: game.playedManagementCard.playedAt
        };
    }

    // Check if a player's loyalty has been revealed to the current player
    hasLoyaltyBeenRevealed(revealerId: string, game: Game): boolean {
        const myId = this.authService.userId();

        if (!myId || !game.revealedLoyalties) {
            return false;
        }

        // Check if the revealer has revealed their loyalty to the current player
        return game.revealedLoyalties[revealerId]?.targetId === myId;
    }

    // Get the squad loyalty of a player (dexter or sinister)
    getPlayerSquadLoyalty(playerId: string, game: Game): 'dexter' | 'sinister' | null {
        if (!game.roles || !game.roles[playerId]) {
            return null;
        }

        const playerRole = game.roles[playerId];

        // Determine if the player is Dexter or Sinister
        if (playerRole.includes('Dexter') || playerRole === 'Duke' || playerRole === 'SupportManager') {
            return 'dexter';
        } else {
            return 'sinister';
        }
    }

    // Get all players who have management cards (excluding the current player)
    playersWithManagementCards(game: Game): string[] {
        const myId = this.authService.userId();
        if (!myId) return [];

        return Object.keys(game.players).filter(playerId => {
            return playerId !== myId &&
                   game.players[playerId].managementCard !== null &&
                   game.players[playerId].managementCard !== undefined;
        });
    }

    // Take a management card from another player
    takeManagementCard(playerId: string, game: Game) {
        const myId = this.authService.userId();
        if (!myId || !game.players[playerId].managementCard) return;

        // Get the card from the other player
        const cardId = game.players[playerId].managementCard;

        // Call the game service to handle the card transfer
        this.gameService.takeCEOManagementCard(playerId, cardId);
    }

    // Draw two cards from the management deck
    drawCEOCards(game: Game) {
        this.gameService.drawCEOCards();
    }

    // Select one of the drawn cards to keep
    selectCEOCard(cardId: string, game: Game) {
        this.gameService.selectCEOCard(cardId);
    }

    // Get tooltip text for discarded management cards
    getDiscardedCardsTooltip(game: Game): string {
        if (!game.discardedManagementCards || game.discardedManagementCards.length === 0) {
            return 'No discarded management cards';
        }

        return game.discardedManagementCards.map(card => {
            const cardInfo = MANAGEMENT_CARDS[card.cardId];
            const playerName = game.players[card.playedBy]?.name || 'Unknown';
            return `${cardInfo.title} (${playerName})`;
        }).join('\n');
    }
}
