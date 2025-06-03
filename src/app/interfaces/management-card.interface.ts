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
    'tl': {
        id: 'tl',
        title: 'Team Lead',
        name: 'Preliminary Review',
        instructions: 'Before any reviews are made, designate a player to review the User Story publicly for all to see. Play after a team is agreed upon during grooming for the 1st, 2nd, 3rd, or 4th User Story. May be played upon drawing before the team enters the Review Phase.',
        playablePhases: ['mission'],
        playableStories: [1, 2, 3, 4],
        imageUrl: 'assets/management/mat.png'
    },
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
        title: 'CEO',
        name: 'The Real Boss!',
        instructions: 'Take another player\'s management card or draw two cards from the management deck, keeping one. Play at any time.',
        playablePhases: ['mission', 'teamProposal', 'teamVoting'],
        playableStories: [1, 2, 3, 4, 5],
        imageUrl: 'assets/management/ceo.png'
    },
    'cmo': {
        id: 'cmo',
        title: 'CMO',
        name: 'Scope Creep!',
        instructions: 'Add an additional person to the development team. Play after a team is agreed upon during grooming for the 1st, 2nd, 3rd, or 4th User Story. May be played upon drawing before the team enters the Review Phase.',
        playablePhases: ['mission'],
        playableStories: [1, 2, 3, 4],
        imageUrl: 'assets/management/cmo.png'
    },
    'coo': {
        id: 'coo',
        title: 'COO',
        name: 'All Hands!',
        instructions: 'The Technical Owner adds players to the development team until it is the same size as the Dexter squad. If the Sales Rep is played, this card must be played. Otherwise...Play after a team is agreed upon during grooming for the 1st, 2nd, 3rd, or 4th User Story. May be played upon drawing before the team enters the Review Phase.',
        playablePhases: ['mission'],
        playableStories: [1, 2, 3, 4],
        imageUrl: 'assets/management/coo.png'
    },
    'cso': {
        id: 'cso',
        title: 'CSO',
        name: 'Security Audit!',
        instructions: 'Secretly inspect a player\'s Pull Request review selection. Choose the target after all selections are locked in. Play after a team is agreed upon during grooming for the 1st, 2nd, 3rd, or 4th User Story. May be played upon drawing before the team enters the Review Phase.',
        playablePhases: ['mission'],
        playableStories: [1, 2, 3, 4],
        imageUrl: 'assets/management/cso.png'
    },
    'cto': {
        id: 'cto',
        title: 'CTO',
        name: 'Foam Dart Assault!',
        instructions: 'Redo a past User Story with its original team less one person of your choice. Play between User Stories. If three User Stories have merged or closed, it is too late to play this card.',
        playablePhases: ['mission'],
        playableStories: [1, 2, 3, 4, 5],
        imageUrl: 'assets/management/cto.png'
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
        title: 'Janitor',
        name: 'You Are a Spy!',
        instructions: 'For as long as you possess this card, you are Sinister. You may request changes, and you win if Sinister wins on the 4th User Story or earlier. On the 5th User Story, you must approve changes. A Dexter Janitor cannot win via game end sniping. Effect occurs immediately, but keep the card concealed as if unplayed.',
        playablePhases: ['mission', 'teamProposal', 'teamVoting'],
        playableStories: [1, 2, 3, 4, 5],
        imageUrl: 'assets/management/janitor.png'
    },
    'joe': {
        id: 'joe',
        title: 'VP R&D',
        name: 'Service Reassignment!',
        instructions: 'Exchange a player on the development team with a player not on the team. Play after a team is agreed upon during grooming for the 1st, 2nd, 3rd, or 4th User Story. May be played upon drawing before the team enters the Review Phase.',
        playablePhases: ['mission'],
        playableStories: [1, 2, 3, 4],
        imageUrl: 'assets/management/joe.png'
    },
    'salesrep': {
        id: 'salesrep',
        title: 'Sales Rep',
        name: 'Rush Job, Tech Debt!',
        instructions: 'All Sinister spies must request changes on the User Story. The result is a merge no matter what. The next User Story has one additional team member. Play after a team is agreed upon during grooming for the 1st, 2nd, or 3rd User Story. May be played upon drawing before the team enters the Review Phase.',
        playablePhases: ['mission'],
        playableStories: [1, 2, 3],
        imageUrl: 'assets/management/salesrep.png'
    },
    'sme': {
        id: 'sme',
        title: 'SME',
        name: 'Creative Differences!',
        instructions: 'Nullify an agreed upon team. Pass the Technical Owner token to the next player. Any played management cards remain in effect. Play after a team is agreed upon during grooming for the 1st, 2nd, 3rd, or 4th User Story. May be played upon drawing before the team enters the Review Phase.',
        playablePhases: ['mission'],
        playableStories: [1, 2, 3, 4],
        imageUrl: 'assets/management/sme.png'
    },
    'vpsales': {
        id: 'vpsales',
        title: 'VP Sales',
        name: 'It\'s Show Time!',
        instructions: 'The Technical Owner adds two people to the User Story. Shuffle the team\'s reviews and reveal the top three cards to determine the story\'s result. Other cards remain unrevealed. Play after a team is agreed upon during grooming for the 1st, 2nd, 3rd, or 4th User Story. May be played upon drawing before the team enters the Review Phase.',
        playablePhases: ['mission'],
        playableStories: [1, 2, 3, 4],
        imageUrl: 'assets/management/vpsales.png'
    }
};
