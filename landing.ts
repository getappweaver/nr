import type { PluginLandingDefinition } from '../../apps/landing/content-types';

export const landingPage: PluginLandingDefinition = {
  route: '/apps/nostr-radar',
  name: 'Nostr Radar',
  shortName: 'Nostr',
  description:
    'Explore Nostr by topic and mood. Choose Jev Mode for fast, low-cost classification, or LLM Mode for summaries, image descriptions, and more reliable classification.',
  features: [
    'Fetch and evaluate posts in finite time slots instead of browsing an infinite feed.',
    'Choose Jev Mode to classify posts by topic and mood quickly at low cost, or LLM Mode for post and image summaries and more reliable classification.',
    'See the 25 most relevant evaluated posts in For You using private local scoring signals.',
    'Filter Timeline and For You by time slot, preferred topics, and unpreferred topics.',
    'Surface reactions, not just reposts or quotes.',
    'Archive important posts to collect or revisit later.',
  ],
  hasInteractiveDemo: false,
  installScreenshot: 'landing/assets/nostr-radar.png',
  assetAliases: [],
  demoStories: [],
  presentation: {
    title:
      'Explore Nostr by topic. Rank what matters. Filter out what does not.',
    description:
      'Nostr Radar discovers posts through your network and evaluates them in finite time slots. Choose Jev Mode for fast, low-cost topic and mood classification, or LLM Mode for post and image summaries and more reliable classification. Private local signals shape relevance.',
    featureGallery: {
      title: 'A reader designed for deliberate discovery.',
      description:
        'Move through finite batches, discover posts through overlooked social signals, and decide which topics deserve your attention.',
      items: [
        {
          id: 'timeline',
          title: 'Timeline',
          description: [
            'Browse posts discovered through your Nostr network without turning your reader into an endless feed.',
            'Nostr Radar fetches and evaluates posts in time slots, making each reading session a manageable batch.',
          ],
          mediaSrc: 'landing/assets/timeline.png',
          mediaAlt:
            'Nostr Radar Timeline showing an evaluated time slot of posts',
          mediaLabel: 'Timeline screenshot',
        },
        {
          id: 'for-you',
          title: 'For You',
          description: [
            'See the 25 posts most relevant to you from the posts Nostr Radar has evaluated.',
            'Ranking uses your preferred topics and private interaction signals stored by your local instance.',
          ],
          mediaSrc: 'landing/assets/for-you.png',
          mediaAlt: 'Nostr Radar For You view showing the most relevant posts',
          mediaLabel: 'For You screenshot',
        },
        {
          id: 'filtering',
          title: 'Filtering',
          description: [
            'Filter both Timeline and For You by time slot, or use mass reading to clear an unwanted topic from either view.',
            'Click Read all on a topic to quickly remove posts matching that keyword. Add recurring unwanted topics to Unpreferred Topics to skip them in the future, or add topics to Preferred Topics to influence scoring.',
          ],
          mediaSrc: 'landing/assets/filtering.png',
          mediaAlt:
            'Nostr Radar filtering posts by time slot and removing posts with Read all',
          mediaLabel: 'Filtering demo',
        },
        {
          id: 'reactions',
          title: 'Reactions',
          description: [
            'Surface reactions, not just reposts or quotes.',
            'People often react or reply when they do not want to repost. Followers’ reactions reveal worthwhile posts that conventional timelines tend to miss.',
          ],
          mediaSrc: 'landing/assets/reactions.png',
          mediaAlt:
            'Nostr Radar showing a post discovered through a follower reaction',
          mediaLabel: 'Reactions screenshot',
        },
        {
          id: 'archive',
          title: 'Archive',
          description: [
            'Archive posts that are important to you, that you want to collect, or that you plan to return to later.',
          ],
          mediaSrc: 'landing/assets/archive.png',
          mediaAlt: 'Nostr Radar Archive containing saved posts',
          mediaLabel: 'Archive screenshot',
        },
        {
          id: 'private-scoring',
          title: 'Private, independent scoring',
          description: [
            'Keep two or more Nostr Radar instances for the same pubkey—one for work and another for personal interests.',
            'Each instance keeps different private signals and runs its own scoring algorithm without requiring another Nostr identity.',
          ],
          mediaSrc: 'landing/assets/private-scoring.svg',
          mediaAlt:
            'Two Nostr Radar instances for the same pubkey with different scoring signals',
          mediaLabel: 'Independent instances illustration',
        },
      ],
    },
  },
  roadmapRepoId: 'Nostr-Radar',
};
