export interface ManagementCard {
    id: string;           // Card identifier (e.g., 'po', 'ceo')
    title: string;        // Management title (e.g., 'PO', 'CEO')
    name: string;         // Card name (e.g., 'Shifting Priorities')
    instructions: string; // Card instructions
    playablePhases: string[]; // Game phases when the card can be played
    playableStories: number[]; // Story numbers when the card can be played (1-5)
    imageUrl?: string;    // Optional image URL
}

// Define the management cards
export const MANAGEMENT_CARDS: { [key: string]: ManagementCard } = {
    'po': {
        id: 'po',
        title: 'PO',
        name: 'Shifting Priorities',
        instructions: 'Switch to the next User Story; the Technical Owner adds or removes players to the team to match the story requirement. Play after a team is agreed upon during grooming for the 1st, 2nd, or 3rd User Story. May be played upon drawing before the team enters the Review Phase.',
        playablePhases: ['mission'],
        playableStories: [1, 2, 3],
        imageUrl: 'assets/management/po.png'
    },
    'ceo': {
        id: 'ceo',
        title: 'HR',
        name: 'People Person',
        instructions: 'Reveal your squad loyalty to a player of your choice. Play immediately after drawing.',
        playablePhases: ['mission', 'teamProposal', 'teamVoting'],
        playableStories: [1, 2, 3, 4, 5],
        imageUrl: 'assets/management/hr.png'
    },
    'cmo': {
        id: 'cmo',
        title: 'HR',
        name: 'People Person',
        instructions: 'Reveal your squad loyalty to a player of your choice. Play immediately after drawing.',
        playablePhases: ['mission', 'teamProposal', 'teamVoting'],
        playableStories: [1, 2, 3, 4, 5],
        imageUrl: 'assets/management/hr.png'
    },
    'coo': {
        id: 'coo',
        title: 'PO',
        name: 'Shifting Priorities',
        instructions: 'Switch to the next User Story; the Technical Owner adds or removes players to the team to match the story requirement. Play after a team is agreed upon during grooming for the 1st, 2nd, or 3rd User Story. May be played upon drawing before the team enters the Review Phase.',
        playablePhases: ['mission'],
        playableStories: [1, 2, 3],
        imageUrl: 'assets/management/po.png'
    },
    'cso': {
        id: 'cso',
        title: 'PO',
        name: 'Shifting Priorities',
        instructions: 'Switch to the next User Story; the Technical Owner adds or removes players to the team to match the story requirement. Play after a team is agreed upon during grooming for the 1st, 2nd, or 3rd User Story. May be played upon drawing before the team enters the Review Phase.',
        playablePhases: ['mission'],
        playableStories: [1, 2, 3],
        imageUrl: 'assets/management/po.png'
    },
    'cto': {
        id: 'cto',
        title: 'PO',
        name: 'Shifting Priorities',
        instructions: 'Switch to the next User Story; the Technical Owner adds or removes players to the team to match the story requirement. Play after a team is agreed upon during grooming for the 1st, 2nd, or 3rd User Story. May be played upon drawing before the team enters the Review Phase.',
        playablePhases: ['mission'],
        playableStories: [1, 2, 3],
        imageUrl: 'assets/management/po.png'
    },
    'hr': {
        id: 'hr',
        title: 'HR',
        name: 'People Person',
        instructions: 'Reveal your squad loyalty to a player of your choice. Play immediately after drawing.',
        playablePhases: ['mission', 'teamProposal', 'teamVoting'],
        playableStories: [1, 2, 3, 4, 5],
        imageUrl: 'assets/management/hr.png'
    },
    'janitor': {
        id: 'janitor',
        title: 'PO',
        name: 'Shifting Priorities',
        instructions: 'Switch to the next User Story; the Technical Owner adds or removes players to the team to match the story requirement. Play after a team is agreed upon during grooming for the 1st, 2nd, or 3rd User Story. May be played upon drawing before the team enters the Review Phase.',
        playablePhases: ['mission'],
        playableStories: [1, 2, 3],
        imageUrl: 'assets/management/po.png'
    },
    'joe': {
        id: 'joe',
        title: 'PO',
        name: 'Shifting Priorities',
        instructions: 'Switch to the next User Story; the Technical Owner adds or removes players to the team to match the story requirement. Play after a team is agreed upon during grooming for the 1st, 2nd, or 3rd User Story. May be played upon drawing before the team enters the Review Phase.',
        playablePhases: ['mission'],
        playableStories: [1, 2, 3],
        imageUrl: 'assets/management/po.png'
    },
    'mat': {
        id: 'mat',
        title: 'PO',
        name: 'Shifting Priorities',
        instructions: 'Switch to the next User Story; the Technical Owner adds or removes players to the team to match the story requirement. Play after a team is agreed upon during grooming for the 1st, 2nd, or 3rd User Story. May be played upon drawing before the team enters the Review Phase.',
        playablePhases: ['mission'],
        playableStories: [1, 2, 3],
        imageUrl: 'assets/management/po.png'
    },
    'salesrep': {
        id: 'salesrep',
        title: 'PO',
        name: 'Shifting Priorities',
        instructions: 'Switch to the next User Story; the Technical Owner adds or removes players to the team to match the story requirement. Play after a team is agreed upon during grooming for the 1st, 2nd, or 3rd User Story. May be played upon drawing before the team enters the Review Phase.',
        playablePhases: ['mission'],
        playableStories: [1, 2, 3],
        imageUrl: 'assets/management/po.png'
    },
    'sme': {
        id: 'sme',
        title: 'PO',
        name: 'Shifting Priorities',
        instructions: 'Switch to the next User Story; the Technical Owner adds or removes players to the team to match the story requirement. Play after a team is agreed upon during grooming for the 1st, 2nd, or 3rd User Story. May be played upon drawing before the team enters the Review Phase.',
        playablePhases: ['mission'],
        playableStories: [1, 2, 3],
        imageUrl: 'assets/management/po.png'
    },
    'vpsales': {
        id: 'vpsales',
        title: 'PO',
        name: 'Shifting Priorities',
        instructions: 'Switch to the next User Story; the Technical Owner adds or removes players to the team to match the story requirement. Play after a team is agreed upon during grooming for the 1st, 2nd, or 3rd User Story. May be played upon drawing before the team enters the Review Phase.',
        playablePhases: ['mission'],
        playableStories: [1, 2, 3],
        imageUrl: 'assets/management/po.png'
    }
};
