// Emoji catalogue for the chat composer, grouped the way the Unicode
// standard groups them so the picker can offer category tabs instead of one
// endless grid.
//
// People emoji are listed in their neutral form plus the woman/man variants
// where those exist, and the common skin-tone modifiers are applied at
// render time (see SKIN_TONES) rather than being written out five times
// each here — that keeps this file readable while still putting every
// variant in reach.
const EMOJI_CATEGORIES = [
  {
    id: 'smileys',
    name: 'Smileys',
    icon: '😀',
    emoji: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '🫠', '😉',
      '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '☺️', '😚', '😙', '🥲', '😋',
      '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭', '🫢', '🫣', '🤫', '🤔', '🫡',
      '🤐', '🤨', '😐', '😑', '😶', '🫥', '😶‍🌫️', '😏', '😒', '🙄', '😬', '😮‍💨',
      '🤥', '🫨', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮',
      '🤧', '🥵', '🥶', '🥴', '😵', '😵‍💫', '🤯', '🤠', '🥳', '🥸', '😎', '🤓',
      '🧐', '😕', '🫤', '😟', '🙁', '☹️', '😮', '😯', '😲', '😳', '🥺', '🥹',
      '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣', '😞', '😓',
      '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '☠️', '💩',
      '🤡', '👹', '👺', '👻', '👽', '👾', '🤖', '😺', '😸', '😹', '😻', '😼',
      '😽', '🙀', '😿', '😾', '🙈', '🙉', '🙊'
    ]
  },
  {
    id: 'love',
    name: 'Love',
    icon: '❤️',
    // Hearts first, then the faces, then couples, then the things that go
    // with them — roughly the order someone reaches for them in.
    emoji: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🤎', '🖤', '🤍', '❤️‍🔥', '❤️‍🩹', '💔',
      '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '♥️', '💌', '💋',
      '😍', '🥰', '😘', '😗', '😙', '😚', '🤩', '😊', '☺️', '😌', '😳', '🥺',
      '😻', '😽', '😈', '😏', '🤭', '🤫', '🤤', '🥱', '😴', '💤', '🙅', '🙊',
      '💑', '💏', '👩‍❤️‍👨', '👨‍❤️‍👨', '👩‍❤️‍👩', '👩‍❤️‍💋‍👨', '👨‍❤️‍💋‍👨', '👩‍❤️‍💋‍👩', '👫', '👬', '👭', '👪',
      '🤵', '👰', '👸', '🤴', '🍾', '🥂', '🎂', '🎁',
      '💍', '💎', '🏵️', '🌹', '🌷', '💐', '🌸', '🌺', '🌻', '🥀', '🍂', '🍊',
      '🍫', '🍰', '🧁', '🍓', '🍒', '🍷', '🍹', '☕', '🥞', '🍯', '🍬', '🍭',
      '🎶', '🎵', '💃', '🕺', '🎡', '🎠', '🕯️', '🎈', '🎊', '🔮', '🏡', '💒',
      '🌞', '🌝', '🌜', '⭐', '🌟', '✨', '💫', '🌈', '🌌', '🌃', '🌇', '🌅',
      '🧸', '🛏️', '🛁', '📞', '📸', '🎞️', '📖', '✍️', '🧩', '🎯', '♾️', '🕊️'
    ]
  },
  {
    id: 'gestures',
    name: 'Gestures',
    icon: '👋',
    // Every hand gesture in the standard, plus body parts. These are the
    // ones that take skin tones, which the picker applies on top.
    emoji: [
      '👋', '🤚', '🖐️', '✋', '🖖', '🫱', '🫲', '🫳', '🫴', '🫷', '🫸', '👌',
      '🤌', '🤏', '✌️', '🤞', '🫰', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕',
      '👇', '☝️', '🫵', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '🫶',
      '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦿', '🦵', '🦶',
      '👣', '👂', '🦻', '👃', '🧠', '🫀', '🫁', '🦷', '🦴', '👀', '👁️', '👅',
      '👄', '🫦', '💋', '🩸'
    ]
  },
  {
    id: 'people',
    name: 'People',
    icon: '🧑',
    emoji: [
      '👶', '🧒', '👦', '👧', '🧑', '👱', '👨', '🧔', '🧔‍♂️', '🧔‍♀️', '👨‍🦰', '👨‍🦱',
      '👨‍🦳', '👨‍🦲', '👩', '👩‍🦰', '🧑‍🦰', '👩‍🦱', '🧑‍🦱', '👩‍🦳', '🧑‍🦳', '👩‍🦲', '🧑‍🦲', '👱‍♀️',
      '👱‍♂️', '🧓', '👴', '👵', '🙍', '🙍‍♂️', '🙍‍♀️', '🙎', '🙎‍♂️', '🙎‍♀️', '🙅', '🙅‍♂️',
      '🙅‍♀️', '🙆', '🙆‍♂️', '🙆‍♀️', '💁', '💁‍♂️', '💁‍♀️', '🙋', '🙋‍♂️', '🙋‍♀️', '🧏', '🧏‍♂️',
      '🧏‍♀️', '🙇', '🙇‍♂️', '🙇‍♀️', '🤦', '🤦‍♂️', '🤦‍♀️', '🤷', '🤷‍♂️', '🤷‍♀️', '🧑‍⚕️', '👨‍⚕️',
      '👩‍⚕️', '🧑‍🎓', '👨‍🎓', '👩‍🎓', '🧑‍🏫', '👨‍🏫', '👩‍🏫', '🧑‍⚖️', '👨‍⚖️', '👩‍⚖️', '🧑‍🌾', '👨‍🌾',
      '👩‍🌾', '🧑‍🍳', '👨‍🍳', '👩‍🍳', '🧑‍🔧', '👨‍🔧', '👩‍🔧', '🧑‍🏭', '👨‍🏭', '👩‍🏭', '🧑‍💼', '👨‍💼',
      '👩‍💼', '🧑‍🔬', '👨‍🔬', '👩‍🔬', '🧑‍💻', '👨‍💻', '👩‍💻', '🧑‍🎤', '👨‍🎤', '👩‍🎤', '🧑‍🎨', '👨‍🎨',
      '👩‍🎨', '🧑‍✈️', '👨‍✈️', '👩‍✈️', '🧑‍🚀', '👨‍🚀', '👩‍🚀', '🧑‍🚒', '👨‍🚒', '👩‍🚒', '👮', '👮‍♂️',
      '👮‍♀️', '🕵️', '🕵️‍♂️', '🕵️‍♀️', '💂', '💂‍♂️', '💂‍♀️', '🥷', '👷', '👷‍♂️', '👷‍♀️', '🫅',
      '🤴', '👸', '👳', '👳‍♂️', '👳‍♀️', '👲', '🧕', '🤵', '🤵‍♂️', '🤵‍♀️', '👰', '👰‍♂️',
      '👰‍♀️', '🤰', '🫄', '🫃', '🤱', '👩‍🍼', '👨‍🍼', '🧑‍🍼', '👼', '🎅', '🤶', '🧑‍🎄',
      '🦸', '🦸‍♂️', '🦸‍♀️', '🦹', '🦹‍♂️', '🦹‍♀️', '🧙', '🧙‍♂️', '🧙‍♀️', '🧚', '🧚‍♂️', '🧚‍♀️',
      '🧛', '🧛‍♂️', '🧛‍♀️', '🧜', '🧜‍♂️', '🧜‍♀️', '🧝', '🧝‍♂️', '🧝‍♀️', '🧞', '🧞‍♂️', '🧞‍♀️',
      '🧟', '🧟‍♂️', '🧟‍♀️', '🧌', '💆', '💆‍♂️', '💆‍♀️', '💇', '💇‍♂️', '💇‍♀️', '🚶', '🚶‍♂️',
      '🚶‍♀️', '🧍', '🧍‍♂️', '🧍‍♀️', '🧎', '🧎‍♂️', '🧎‍♀️', '🏃', '🏃‍♂️', '🏃‍♀️', '💃', '🕺',
      '🕴️', '👯', '👯‍♂️', '👯‍♀️', '🧖', '🧖‍♂️', '🧖‍♀️', '🧗', '🧗‍♂️', '🧗‍♀️', '🤺', '🏇',
      '⛷️', '🏂', '🏌️', '🏌️‍♂️', '🏌️‍♀️', '🏄', '🏄‍♂️', '🏄‍♀️', '🚣', '🚣‍♂️', '🚣‍♀️', '🏊',
      '🏊‍♂️', '🏊‍♀️', '⛹️', '⛹️‍♂️', '⛹️‍♀️', '🏋️', '🏋️‍♂️', '🏋️‍♀️', '🚴', '🚴‍♂️', '🚴‍♀️', '🚵',
      '🚵‍♂️', '🚵‍♀️', '🤸', '🤸‍♂️', '🤸‍♀️', '🤼', '🤼‍♂️', '🤼‍♀️', '🤽', '🤽‍♂️', '🤽‍♀️', '🤾',
      '🤾‍♂️', '🤾‍♀️', '🤹', '🤹‍♂️', '🤹‍♀️', '🧘', '🧘‍♂️', '🧘‍♀️', '🛀', '🛌', '🧑‍🤝‍🧑', '👭',
      '👫', '👬', '💏', '👩‍❤️‍💋‍👨', '👨‍❤️‍💋‍👨', '👩‍❤️‍💋‍👩', '💑', '👩‍❤️‍👨', '👨‍❤️‍👨', '👩‍❤️‍👩', '👪', '👨‍👩‍👦',
      '👨‍👩‍👧', '👨‍👩‍👧‍👦', '👨‍👩‍👦‍👦', '👨‍👩‍👧‍👧', '👩‍👦', '👩‍👧', '👨‍👦', '👨‍👧', '🗣️', '👤', '👥', '🫂'
    ]
  },
  {
    id: 'nature',
    name: 'Nature',
    icon: '🐶',
    emoji: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐻‍❄️', '🐨', '🐯', '🦁',
      '🐮', '🐷', '🐽', '🐸', '🐵', '🙈', '🙉', '🙊', '🐒', '🐔', '🐧', '🐦',
      '🐤', '🐣', '🐥', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝',
      '🪱', '🐛', '🦋', '🐌', '🐞', '🐜', '🪰', '🪲', '🪳', '🦟', '🦗', '🕷️',
      '🕸️', '🦂', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀',
      '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🦭', '🐊', '🐅', '🐆', '🦓',
      '🦍', '🦧', '🦣', '🐘', '🦛', '🦏', '🐪', '🐫', '🦒', '🦘', '🦬', '🐃',
      '🐂', '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🦮',
      '🐕‍🦺', '🐈', '🐈‍⬛', '🪶', '🐓', '🦃', '🦤', '🦚', '🦜', '🦢', '🦩', '🕊️',
      '🐇', '🦝', '🦨', '🦡', '🦫', '🦦', '🦥', '🐁', '🐀', '🐿️', '🦔', '🐾',
      '🐉', '🐲', '🌵', '🎄', '🌲', '🌳', '🌴', '🪵', '🌱', '🌿', '☘️', '🍀',
      '🎍', '🪴', '🎋', '🍃', '🍂', '🍁', '🍄', '🐚', '🪸', '🪨', '🌾', '💐',
      '🌷', '🌹', '🥀', '🌺', '🌸', '🌼', '🌻', '🌞', '🌝', '🌛', '🌜', '🌚',
      '🌕', '🌖', '🌗', '🌘', '🌑', '🌒', '🌓', '🌔', '🌙', '🌎', '🌍', '🌏',
      '🪐', '💫', '⭐', '🌟', '✨', '⚡', '☄️', '💥', '🔥', '🌪️', '🌈', '☀️',
      '🌤️', '⛅', '🌥️', '☁️', '🌦️', '🌧️', '⛈️', '🌩️', '🌨️', '❄️', '☃️', '⛄',
      '🌬️', '💨', '💧', '💦', '🫧', '☔', '☂️', '🌊', '🌫️'
    ]
  },
  {
    id: 'food',
    name: 'Food',
    icon: '🍔',
    emoji: [
      '🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒',
      '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶️',
      '🫑', '🌽', '🥕', '🫒', '🧄', '🧅', '🥔', '🍠', '🫘', '🥐', '🥯', '🍞',
      '🥖', '🥨', '🧀', '🥚', '🍳', '🧈', '🥞', '🧇', '🥓', '🥩', '🍗', '🍖',
      '🦴', '🌭', '🍔', '🍟', '🍕', '🫓', '🥪', '🥙', '🧆', '🌮', '🌯', '🫔',
      '🥗', '🥘', '🫕', '🥫', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🦪',
      '🍤', '🍙', '🍚', '🍘', '🍥', '🥠', '🥮', '🍢', '🍡', '🍧', '🍨', '🍦',
      '🥧', '🧁', '🍰', '🎂', '🍮', '🍭', '🍬', '🍫', '🍿', '🍩', '🍪', '🌰',
      '🥜', '🍯', '🥛', '🍼', '🫖', '☕', '🍵', '🧃', '🥤', '🧋', '🍶', '🍺',
      '🍻', '🥂', '🍷', '🥃', '🍸', '🍹', '🧉', '🍾', '🧊', '🥄', '🍴', '🍽️',
      '🥣', '🥡', '🥢', '🧂'
    ]
  },
  {
    id: 'activity',
    name: 'Activity',
    icon: '⚽',
    emoji: [
      '⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓',
      '🏸', '🏒', '🏑', '🥍', '🏏', '🪃', '🥅', '⛳', '🪁', '🏹', '🎣', '🤿',
      '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸️', '🥌', '🎿', '⛷️', '🏂', '🪂',
      '🏋️', '🤼', '🤸', '⛹️', '🤺', '🤾', '🏌️', '🏇', '🧘', '🏄', '🏊', '🤽',
      '🚣', '🧗', '🚵', '🚴', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖️', '🏵️', '🎗️',
      '🎫', '🎟️', '🎪', '🤹', '🎭', '🩰', '🎨', '🎬', '🎤', '🎧', '🎼', '🎵',
      '🎶', '🥁', '🪘', '🎹', '🎷', '🎺', '🪗', '🎸', '🪕', '🎻', '🪈', '🎲',
      '♟️', '🎯', '🎳', '🎮', '🕹️', '🎰', '🧩'
    ]
  },
  {
    id: 'travel',
    name: 'Travel',
    icon: '✈️',
    emoji: [
      '🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐', '🛻', '🚚',
      '🚛', '🚜', '🦯', '🦽', '🦼', '🛴', '🚲', '🛵', '🏍️', '🛺', '🚨', '🚔',
      '🚍', '🚘', '🚖', '🚡', '🚠', '🚟', '🚃', '🚋', '🚞', '🚝', '🚄', '🚅',
      '🚈', '🚂', '🚆', '🚇', '🚊', '🚉', '✈️', '🛫', '🛬', '🛩️', '💺', '🛰️',
      '🚀', '🛸', '🚁', '🛶', '⛵', '🚤', '🛥️', '🛳️', '⛴️', '🚢', '⚓', '🪝',
      '⛽', '🚧', '🚦', '🚥', '🗺️', '🗿', '🗽', '🗼', '🏰', '🏯', '🏟️', '🎡',
      '🎢', '🎠', '⛲', '⛱️', '🏖️', '🏝️', '🏜️', '🌋', '⛰️', '🏔️', '🗻', '🏕️',
      '⛺', '🛖', '🏠', '🏡', '🏘️', '🏚️', '🏗️', '🏭', '🏢', '🏬', '🏣', '🏤',
      '🏥', '🏦', '🏨', '🏪', '🏫', '🏩', '💒', '🏛️', '⛪', '🕌', '🕍', '🛕',
      '🕋', '⛩️', '🛤️', '🛣️', '🗾', '🎑', '🏞️', '🌅', '🌄', '🌠', '🎇', '🎆',
      '🌇', '🌆', '🏙️', '🌃', '🌌', '🌉', '🌁'
    ]
  },
  {
    id: 'objects',
    name: 'Objects',
    icon: '💡',
    emoji: [
      '⌚', '📱', '📲', '💻', '⌨️', '🖥️', '🖨️', '🖱️', '🖲️', '🕹️', '🗜️', '💽',
      '💾', '💿', '📀', '📼', '📷', '📸', '📹', '🎥', '📽️', '🎞️', '📞', '☎️',
      '📟', '📠', '📺', '📻', '🎙️', '🎚️', '🎛️', '🧭', '⏱️', '⏲️', '⏰', '🕰️',
      '⌛', '⏳', '📡', '🔋', '🪫', '🔌', '💡', '🔦', '🕯️', '🪔', '🧯', '🛢️',
      '💸', '💵', '💴', '💶', '💷', '🪙', '💰', '💳', '🪪', '💎', '⚖️', '🪜',
      '🧰', '🪛', '🔧', '🔨', '⚒️', '🛠️', '⛏️', '🪚', '🔩', '⚙️', '🪤', '🧱',
      '⛓️', '🧲', '🔫', '💣', '🧨', '🪓', '🔪', '🗡️', '⚔️', '🛡️', '🚬', '⚰️',
      '🪦', '⚱️', '🏺', '🔮', '📿', '🧿', '🪬', '💈', '⚗️', '🔭', '🔬', '🕳️',
      '🩻', '🩹', '🩺', '💊', '💉', '🩸', '🧬', '🦠', '🧫', '🧪', '🌡️', '🧹',
      '🪠', '🧺', '🧻', '🚽', '🚰', '🚿', '🛁', '🛀', '🧼', '🪥', '🪒', '🧽',
      '🪣', '🧴', '🛎️', '🔑', '🗝️', '🚪', '🪑', '🛋️', '🛏️', '🧸', '🪆', '🖼️',
      '🪞', '🪟', '🛍️', '🛒', '🎁', '🎈', '🎏', '🎀', '🪄', '🪅', '🎊', '🎉',
      '🪩', '🎎', '🏮', '🎐', '🧧', '✉️', '📩', '📨', '📧', '💌', '📥', '📤',
      '📦', '🏷️', '🪧', '📪', '📫', '📬', '📭', '📮', '📯', '📜', '📃', '📄',
      '📑', '🧾', '📊', '📈', '📉', '🗒️', '🗓️', '📆', '📅', '🗑️', '📇', '🗃️',
      '🗳️', '🗄️', '📋', '📁', '📂', '🗂️', '🗞️', '📰', '📓', '📔', '📒', '📕',
      '📗', '📘', '📙', '📚', '📖', '🔖', '🧷', '🔗', '📎', '🖇️', '📐', '📏',
      '🧮', '📌', '📍', '✂️', '🖊️', '🖋️', '✒️', '🖌️', '🖍️', '📝', '✏️', '🔍',
      '🔎', '🔏', '🔐', '🔒', '🔓', '🧳', '🌂', '☂️', '👓', '🕶️', '🥽', '🥼',
      '🦺', '👔', '👕', '👖', '🧣', '🧤', '🧥', '🧦', '👗', '👘', '🥻', '🩱',
      '🩲', '🩳', '👙', '👚', '👛', '👜', '👝', '🎒', '👞', '👟', '🥾', '🥿',
      '👠', '👡', '🩰', '👢', '👑', '👒', '🎩', '🎓', '🧢', '⛑️', '🪖', '💄',
      '💍', '💼'
    ]
  },
  {
    id: 'symbols',
    name: 'Symbols',
    icon: '❤️',
    emoji: [
      '❤️', '🩷', '🧡', '💛', '💚', '💙', '🩵', '💜', '🖤', '🩶', '🤍', '🤎',
      '💔', '❤️‍🔥', '❤️‍🩹', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟',
      '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎',
      '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓',
      '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳', '🈶', '🈚', '🈸', '🈺', '🈷️',
      '✴️', '🆚', '💮', '🉐', '㊙️', '㊗️', '🈴', '🈵', '🈹', '🈲', '🅰️', '🅱️',
      '🆎', '🆑', '🅾️', '🆘', '❌', '⭕', '🛑', '⛔', '📛', '🚫', '💯', '💢',
      '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❗', '❕', '❓', '❔',
      '‼️', '⁉️', '🔅', '🔆', '〽️', '⚠️', '🚸', '🔱', '⚜️', '🔰', '♻️', '✅',
      '🈯', '💹', '❇️', '✳️', '❎', '🌐', '💠', 'Ⓜ️', '🌀', '💤', '🏧', '🚾',
      '♿', '🅿️', '🛗', '🈳', '🈂️', '🛂', '🛃', '🛄', '🛅', '🚹', '🚺', '🚼',
      '⚧️', '🚻', '🚮', '🎦', '📶', '🈁', '🔣', 'ℹ️', '🔤', '🔡', '🔠', '🆖',
      '🆗', '🆙', '🆒', '🆕', '🆓', '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣',
      '7️⃣', '8️⃣', '9️⃣', '🔟', '🔢', '#️⃣', '*️⃣', '⏏️', '▶️', '⏸️', '⏯️', '⏹️',
      '⏺️', '⏭️', '⏮️', '⏩', '⏪', '⏫', '⏬', '◀️', '🔼', '🔽', '➡️', '⬅️',
      '⬆️', '⬇️', '↗️', '↘️', '↙️', '↖️', '↕️', '↔️', '↪️', '↩️', '⤴️', '⤵️',
      '🔀', '🔁', '🔂', '🔄', '🔃', '🎵', '🎶', '➕', '➖', '➗', '✖️', '🟰',
      '♾️', '💲', '💱', '™️', '©️', '®️', '👁️‍🗨️', '🔚', '🔙', '🔛', '🔝', '🔜',
      '〰️', '➰', '➿', '✔️', '☑️', '🔘', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣',
      '⚫', '⚪', '🟤', '🔺', '🔻', '🔸', '🔹', '🔶', '🔷', '🔳', '🔲', '▪️',
      '▫️', '◾', '◽', '◼️', '◻️', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '⬛',
      '⬜', '🟫', '🔈', '🔇', '🔉', '🔊', '🔔', '🔕', '📣', '📢', '💬', '💭',
      '🗯️', '♠️', '♣️', '♥️', '♦️', '🃏', '🎴', '🀄', '🕐', '🕑', '🕒', '🕓',
      '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛'
    ]
  },
  {
    id: 'flags',
    name: 'Flags',
    icon: '🏳️',
    emoji: [
      '🏳️', '🏴', '🏴‍☠️', '🏁', '🚩', '🏳️‍🌈', '🏳️‍⚧️', '🇵🇰', '🇮🇳', '🇧🇩', '🇸🇦', '🇦🇪',
      '🇹🇷', '🇬🇧', '🇺🇸', '🇨🇦', '🇦🇺', '🇩🇪', '🇫🇷', '🇮🇹', '🇪🇸', '🇯🇵', '🇰🇷', '🇨🇳',
      '🇷🇺', '🇧🇷', '🇿🇦', '🇲🇾', '🇮🇩', '🇸🇬', '🇶🇦', '🇰🇼', '🇴🇲', '🇮🇷', '🇦🇫', '🇱🇰',
      '🇳🇵', '🇲🇻', '🇹🇭', '🇵🇭', '🇻🇳', '🇪🇬', '🇲🇦', '🇳🇬', '🇰🇪', '🇺🇦', '🇵🇱', '🇳🇱',
      '🇸🇪', '🇳🇴', '🇩🇰', '🇫🇮', '🇨🇭', '🇦🇹', '🇧🇪', '🇵🇹', '🇬🇷', '🇮🇪', '🇳🇿', '🇲🇽',
      '🇦🇷', '🇨🇱', '🇨🇴', '🇵🇪'
    ]
  }
];

// Applied to the gesture/people emoji that support them. The picker offers
// these as a row of swatches; picking one re-renders those categories with
// the modifier appended.
const SKIN_TONES = [
  { id: 'default', label: 'Default', swatch: '✋', modifier: '' },
  { id: 'light', label: 'Light', swatch: '✋🏻', modifier: '\u{1F3FB}' },
  { id: 'medium-light', label: 'Medium light', swatch: '✋🏼', modifier: '\u{1F3FC}' },
  { id: 'medium', label: 'Medium', swatch: '✋🏽', modifier: '\u{1F3FD}' },
  { id: 'medium-dark', label: 'Medium dark', swatch: '✋🏾', modifier: '\u{1F3FE}' },
  { id: 'dark', label: 'Dark', swatch: '✋🏿', modifier: '\u{1F3FF}' }
];

// Categories whose emoji accept a skin-tone modifier.
const TONEABLE_CATEGORIES = new Set(['gestures', 'people']);

// A skin tone goes after the base character but before any variation
// selector or ZWJ sequence, so it can't just be concatenated onto the end.
// Sequences that already encode multiple people (couples, families) are
// left alone — a single modifier can't describe them.
function applySkinTone(emoji, modifier) {
  if (!modifier) return emoji;
  if (emoji.includes('‍')) return emoji; // ZWJ sequence
  const codepoints = [...emoji];
  if (codepoints.length !== 1) return emoji;
  return codepoints[0] + modifier;
}

// Flat list of every emoji, used for search and kept for anything that
// still expects the old single-array export.
const EMOJI_LIST = EMOJI_CATEGORIES.flatMap((category) => category.emoji);

// ---------- Rendering support ----------
// The catalogue is aspirational: it lists what the *standard* has, not what
// the device in front of you can draw. Windows 10 ships a Segoe UI Emoji that
// predates Unicode 13.1, so on a laptop 87 of these come out as empty boxes
// and another 41 come out as two glyphs side by side instead of one — the
// gender-neutral professions (🧑‍⚕️, 🧑‍🎓) and the compound faces (😮‍💨, 😵‍💫)
// especially. Android draws all of them. That is the whole "emoji look fine
// on my phone but not on the laptop" report, and no amount of picking
// different emoji fixes it, because the gap is in the font.
//
// So: ask the device what it can actually draw, pull in a font that covers
// the rest when there is a gap, and hide anything still unrenderable. What
// stays in the picker is then exactly what the person will see.

// Named emoji fonts first, so a system that has one uses it rather than
// falling through to a text font that draws boxes. The stack lives here and
// is applied by CSS via --emoji-font.
const EMOJI_FONT_STACK =
  '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji","Android Emoji","EmojiOne Color","Twemoji Mozilla","Segoe UI Symbol"';

const NOTO_EMOJI_CSS = 'https://fonts.googleapis.com/css2?family=Noto+Color+Emoji&display=swap';

// U+10FFFF is permanently unassigned, so whatever a browser draws for it is
// its "no glyph" mark. Anything that renders identically is a box.
const TOFU_CHAR = '\u{10FFFF}';
const REFERENCE_EMOJI = '\u{1F600}'; // 😀 — in every emoji font ever shipped

const unsupportedEmoji = new Set();
// The in-flight detection, not a boolean. A flag lets a second caller past
// while the first is still awaiting the font download, and it then reads an
// empty `unsupportedEmoji` as "everything is fine" — so the picker renders
// the full catalogue, boxes and all, which is the exact bug this file exists
// to prevent. Everyone waits on the same promise instead.
let emojiSupportPromise = null;

function hashPixels(data) {
  // FNV-1a. A string join of 3k numbers per emoji, run across the whole
  // catalogue, is what makes the naive version of this take seconds.
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i += 4) {
    h ^= data[i] + data[i + 1] * 3 + data[i + 2] * 7 + data[i + 3] * 11;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function createEmojiProbe(fontStack) {
  const canvas = document.createElement('canvas');
  canvas.width = 28;
  canvas.height = 28;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.font = `20px ${fontStack}`;
  ctx.textBaseline = 'top';

  const draw = (text) => {
    ctx.clearRect(0, 0, 28, 28);
    ctx.fillText(text, 0, 0);
    return hashPixels(ctx.getImageData(0, 0, 28, 28).data);
  };

  return {
    tofu: draw(TOFU_CHAR),
    blank: draw(' '),
    singleWidth: ctx.measureText(REFERENCE_EMOJI).width,
    tofuWidth: ctx.measureText(TOFU_CHAR).width,
    widthOf: (text) => ctx.measureText(text).width,
    draw
  };
}

// A width comparison is cheap and needs no pixel readback, so it runs first
// across the whole catalogue; only its suspicions cost a getImageData. Doing
// it the other way round means ~1750 GPU readbacks and a visible freeze.
function collectUnsupported(fontStack) {
  const probe = createEmojiProbe(fontStack);
  const missing = new Set();
  if (!probe) return missing;

  for (const category of EMOJI_CATEGORIES) {
    for (const emoji of category.emoji) {
      const width = probe.widthOf(emoji);

      // A ZWJ sequence the font cannot compose is drawn as its parts, so it
      // comes out far wider than one emoji. It renders "fine" by every pixel
      // test — as the wrong thing.
      if (emoji.includes('\u200D') && width > probe.singleWidth * 1.4) {
        missing.add(emoji);
        continue;
      }

      if (Math.abs(width - probe.tofuWidth) < 0.5) {
        const hash = probe.draw(emoji);
        if (hash === probe.tofu || hash === probe.blank) missing.add(emoji);
      }
    }
  }
  return missing;
}

function loadNotoColorEmoji() {
  return new Promise((resolve) => {
    if (document.querySelector('link[data-noto-emoji]')) return resolve();
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = NOTO_EMOJI_CSS;
    link.setAttribute('data-noto-emoji', '');
    link.onload = resolve;
    link.onerror = resolve;
    document.head.appendChild(link);
  });
}

// Runs once; every caller resolves together, when the picker can be trusted
// to only offer emoji the device will actually draw.
function ensureEmojiSupportChecked() {
  if (!emojiSupportPromise) emojiSupportPromise = detectEmojiSupport();
  return emojiSupportPromise;
}

async function detectEmojiSupport() {
  let missing = collectUnsupported(EMOJI_FONT_STACK);
  if (missing.size === 0) return unsupportedEmoji; // phones land here — no download
  const unsupportedCandidates = missing;

  // There is a gap, so it is worth fetching a font that covers it. Only the
  // devices that need it pay for the download.
  try {
    await Promise.race([loadNotoColorEmoji(), new Promise((r) => setTimeout(r, 4000))]);
    if (document.fonts && document.fonts.load) {
      // The second argument is not optional in practice. document.fonts.load()
      // defaults to probing with the text "BESbswy", which contains no emoji
      // at all — against a font whose unicode-range covers only emoji that
      // matches nothing, so the file is never actually fetched and the probe
      // below then finds the font no better than the system one. Ask with
      // characters the font is actually for.
      const probeText = REFERENCE_EMOJI + [...unsupportedCandidates].slice(0, 8).join('');
      await Promise.race([
        document.fonts.load('20px "Noto Color Emoji"', probeText),
        new Promise((r) => setTimeout(r, 4000))
      ]);
    }
  } catch (err) {
    /* offline, or the font host is unreachable — the filter below still holds */
  }

  // Noto goes first this time. Order matters for the split-ZWJ half of the
  // problem: font fallback is per missing glyph, and Segoe *has* 🧑 and ⚕️
  // separately, so it never falls through for 🧑‍⚕️ — it just draws both.
  // Only putting a font that composes the sequence ahead of it fixes that.
  const withNoto = `"Noto Color Emoji",${EMOJI_FONT_STACK}`;
  const stillMissing = collectUnsupported(withNoto);

  if (stillMissing.size < missing.size) {
    document.documentElement.classList.add('emoji-webfont');
    missing = stillMissing;
  }

  missing.forEach((e) => unsupportedEmoji.add(e));
  return unsupportedEmoji;
}

function isEmojiRenderable(emoji) {
  return !unsupportedEmoji.has(emoji);
}
