import { randomInt } from 'node:crypto';

/**
 * Cadet Portal passwords are issued by school staff, never derived from
 * profile data: two different words from this list plus a two-digit number,
 * for example `happy-tiger-27`. With 524 words that is 524 x 523 x 90, about
 * 24.7 million combinations, which the per-admission sign-in lockout makes
 * impractical to guess online.
 *
 * The list is curated for young children: simple animals, fruits, colours,
 * nature and everyday things they know. It deliberately leaves out:
 * - words one edit away from another word in the list (`cat`/`hat`,
 *   `berry`/`ferry`), so a password read aloud or written down is not
 *   mistaken for a neighbour;
 * - homophones and words with slang or rude readings, and animals commonly
 *   used as insults, so no pairing reads as something unkind or rude;
 * - words longer than nine letters, so passwords stay easy to type.
 * The unit tests enforce the mechanical rules (format, uniqueness, length,
 * edit distance); adding a word means checking the rest by hand.
 */
export const CADET_PASSWORD_WORDS: readonly string[] = Object.freeze([
  'able', 'acorn', 'acrobat', 'active', 'airplane', 'alligator', 'almond',
  'alpine', 'amazing', 'amber', 'anchor', 'apple', 'apricot', 'arcade',
  'arctic', 'arrow', 'aurora', 'autumn', 'avocado', 'awesome', 'badge',
  'bagel', 'bakery', 'balloon', 'bamboo', 'banjo', 'banner', 'barley',
  'basket', 'beach', 'beacon', 'beanbag', 'beetle', 'bicycle', 'birch',
  'biscuit', 'bison', 'blanket', 'bloom', 'blossom', 'blue', 'bluebell',
  'blueberry', 'bluebird', 'boat', 'bold', 'bonnet', 'bottle', 'bounce',
  'brave', 'breeze', 'brick', 'bridge', 'bright', 'broccoli', 'brook', 'brown',
  'bubble', 'bucket', 'buddy', 'bugle', 'butter', 'buttercup', 'butterfly',
  'button', 'cabbage', 'cabin', 'cactus', 'calm', 'camel', 'camera', 'camping',
  'canary', 'candle', 'canoe', 'canyon', 'captain', 'caramel', 'carnival',
  'castle', 'cedar', 'celery', 'cello', 'chalk', 'champion', 'charming',
  'cheerful', 'cheese', 'cheetah', 'chess', 'chestnut', 'chimney', 'chipmunk',
  'cinnamon', 'circle', 'citrus', 'clarinet', 'clever', 'cliff', 'clock',
  'cloud', 'cocoa', 'coconut', 'comet', 'compass', 'cookie', 'copper', 'coral',
  'cosmic', 'cotton', 'cozy', 'crane', 'crayon', 'creek', 'cricket', 'crisp',
  'crystal', 'cupcake', 'curious', 'cyan', 'daffodil', 'daisy', 'dancing',
  'dandelion', 'dazzle', 'desert', 'dewdrop', 'diamond', 'dinosaur', 'dolphin',
  'domino', 'dove', 'dragon', 'dragonfly', 'dream', 'drum', 'dune', 'eager',
  'eagle', 'earth', 'easel', 'echo', 'elegant', 'elephant', 'emerald',
  'falcon', 'fancy', 'feast', 'feather', 'fern', 'festive', 'field', 'fig',
  'finch', 'firefly', 'flag', 'flamingo', 'flower', 'flute', 'forest',
  'fossil', 'friendly', 'frost', 'fruit', 'gadget', 'galaxy', 'garden',
  'garlic', 'gazelle', 'gecko', 'gentle', 'giant', 'ginger', 'giraffe',
  'glacier', 'glad', 'glider', 'glitter', 'globe', 'glow', 'golden',
  'goldfish', 'gondola', 'grape', 'grassy', 'gravel', 'green', 'grove',
  'guava', 'guitar', 'gull', 'hammer', 'hammock', 'happy', 'harbor', 'harmony',
  'harvest', 'hazel', 'hearty', 'hedge', 'hedgehog', 'helmet', 'helpful',
  'heron', 'hiking', 'hill', 'hilltop', 'hippo', 'honest', 'honey', 'honeydew',
  'hopeful', 'hopscotch', 'horizon', 'husky', 'iceberg', 'igloo', 'iguana',
  'indigo', 'iris', 'island', 'ivory', 'jacket', 'jade', 'jaguar', 'jasmine',
  'jigsaw', 'jolly', 'journey', 'juggler', 'jungle', 'kangaroo', 'kayak',
  'kettle', 'keyboard', 'kind', 'kingdom', 'kite', 'kiwi', 'koala', 'ladder',
  'ladybug', 'lagoon', 'lantern', 'lavender', 'legend', 'lemon', 'lemonade',
  'leopard', 'library', 'lilac', 'lily', 'lime', 'linen', 'little', 'lively',
  'llama', 'lobster', 'lollipop', 'lotus', 'lucky', 'lunar', 'lychee', 'magic',
  'magnet', 'magpie', 'manatee', 'mango', 'maple', 'marble', 'marigold',
  'marmalade', 'marsh', 'meadow', 'melody', 'mermaid', 'merry', 'meteor',
  'midnight', 'mighty', 'mint', 'mirror', 'mitten', 'modest', 'moonbeam',
  'moose', 'morning', 'mosaic', 'mossy', 'mountain', 'museum', 'mushroom',
  'mustard', 'nacho', 'napkin', 'narwhal', 'navy', 'nest', 'nimble', 'noble',
  'noodle', 'north', 'nutmeg', 'oak', 'oasis', 'ocean', 'octopus', 'olive',
  'onion', 'opal', 'orange', 'orbit', 'orca', 'orchard', 'orchid', 'ostrich',
  'otter', 'owl', 'oyster', 'paddle', 'paintbox', 'palace', 'pancake', 'panda',
  'panther', 'papaya', 'parade', 'parrot', 'pasta', 'pastel', 'peaceful',
  'peacock', 'pebble', 'pelican', 'penguin', 'penny', 'pepper', 'petal',
  'piano', 'pickle', 'picnic', 'pigeon', 'pilot', 'pine', 'pineapple',
  'pinwheel', 'pistachio', 'planet', 'playful', 'plum', 'polite', 'polka',
  'pony', 'popcorn', 'poppy', 'potato', 'prairie', 'pretzel', 'proud',
  'pudding', 'puffin', 'pumpkin', 'puppet', 'purple', 'puzzle', 'pyramid',
  'quail', 'quartz', 'quick', 'quiet', 'rabbit', 'raccoon', 'radish',
  'rainbow', 'raindrop', 'raisin', 'ranger', 'rapid', 'raspberry', 'raven',
  'ready', 'redwood', 'reef', 'reindeer', 'rhino', 'ribbon', 'riddle',
  'ripple', 'river', 'robin', 'robot', 'rocket', 'rocky', 'rosy', 'rowboat',
  'royal', 'ruby', 'rusty', 'sailboat', 'sailor', 'salmon', 'sandal', 'sandy',
  'sapphire', 'scarlet', 'scooter', 'seagull', 'seahorse', 'sesame', 'shiny',
  'shore', 'silver', 'simple', 'sincere', 'skate', 'sketch', 'sky', 'skylark',
  'smart', 'smiling', 'snowflake', 'snowman', 'snowy', 'soccer', 'sofa',
  'solar', 'spaceship', 'sparrow', 'spinach', 'sponge', 'spring', 'sprinkle',
  'sprout', 'spruce', 'squirrel', 'stardust', 'starfish', 'starlight',
  'starship', 'steady', 'stencil', 'stone', 'stripe', 'sturdy', 'sugar',
  'summer', 'sunbeam', 'sunflower', 'sunny', 'sunrise', 'swan', 'sweater',
  'swift', 'tablet', 'tadpole', 'tangerine', 'teacup', 'teal', 'teapot',
  'teaspoon', 'teddy', 'tennis', 'thunder', 'ticket', 'tidy', 'tiger',
  'timber', 'tiptoe', 'toast', 'tomato', 'topaz', 'tortoise', 'toucan',
  'tractor', 'treasure', 'tricycle', 'trinket', 'trolley', 'trumpet', 'tulip',
  'tuna', 'turnip', 'turquoise', 'turtle', 'twinkle', 'umbrella', 'unicorn',
  'valley', 'vanilla', 'velvet', 'violet', 'violin', 'vista', 'volcano',
  'voyage', 'waffle', 'wagon', 'walnut', 'walrus', 'warm', 'water',
  'waterfall', 'whale', 'wheat', 'whistle', 'willow', 'windmill', 'window',
  'winter', 'wise', 'wizard', 'wombat', 'wonder', 'woolly', 'yellow', 'yogurt',
  'young', 'yummy', 'zany', 'zebra', 'zesty', 'zigzag', 'zipper', 'zucchini',
]);

/** The issued password's number is two digits without a leading zero. */
const MIN_NUMBER = 10;
const MAX_NUMBER_EXCLUSIVE = 100;

/**
 * Generates a Cadet Portal password with a cryptographically secure,
 * unbiased random source: `<word>-<different word>-<10..99>`.
 */
export function generateCadetPassword(): string {
  const first = randomInt(CADET_PASSWORD_WORDS.length);
  // Pick from the remaining words so the two words always differ.
  let second = randomInt(CADET_PASSWORD_WORDS.length - 1);
  if (second >= first) second += 1;
  const number = randomInt(MIN_NUMBER, MAX_NUMBER_EXCLUSIVE);
  return `${CADET_PASSWORD_WORDS[first]}-${CADET_PASSWORD_WORDS[second]}-${number}`;
}
