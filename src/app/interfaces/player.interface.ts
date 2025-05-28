export interface Player {
    id: string;
    name: string;
    avatarText?: string; // e.g., P1
    color?: string; // Hex color for UI
    isHost?: boolean;
    role?: string; // 'Duke', 'Sniper', 'LoyalDexter', 'SinisterSpy', etc.
    // Add other player-specific game state if needed
}