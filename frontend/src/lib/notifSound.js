export const NOTIF_SOUND_GROUPS = [
  {
    group: 'Silent',
    hi: '',
    sounds: [
      { id: 'none', label: 'Silent', hi: 'मौन', url: null },
    ],
  },
  {
    group: 'Indian Classical',
    hi: 'शास्त्रीय',
    sounds: [
      { id: 'tabla',  label: 'Tabla',       hi: 'तबला',  url: '/sounds/tabla.mp3' },
      { id: 'sitar',  label: 'Sitar',       hi: 'सितार', url: '/sounds/sitar.mp3' },
      { id: 'dhol',   label: 'Dhol',        hi: 'ढोल',   url: '/sounds/dhol.mp3' },
      { id: 'salute', label: 'Salute horn', hi: 'सलामी', url: '/sounds/salute.mp3' },
    ],
  },
  {
    group: 'Indian Funny',
    hi: 'देसी हास्य',
    sounds: [
      { id: 'rickshaw_horn',      label: 'Rickshaw horn',      hi: 'रिक्शा',   url: '/sounds/rickshaw_horn.mp3' },
      { id: 'shehnai_gone_wrong', label: 'Shehnai gone wrong', hi: 'शहनाई',    url: '/sounds/shehnai_gone_wrong.mp3' },
    ],
  },
  {
    group: 'Gujju — Sounds',
    hi: 'ગુજ્જુ',
    sounds: [
      { id: 'garba_dhol',     label: 'Garba dhol',     hi: 'ગરબા',   url: '/sounds/garba_dhol.mp3' },
      { id: 'kem_cho',        label: 'Kem cho (tone)', hi: 'કેમ છો',  url: '/sounds/kem_cho.mp3' },
    ],
  },
  {
    group: 'Gujju — Voice',
    hi: 'ગુજ્જુ અવાજ',
    sounds: [
      { id: 'kem_cho_voice', label: 'Kem cho?',                  hi: 'કેમ છો?',              url: '/sounds/kem_cho_voice.mp3' },
      { id: 'kaam_karo',     label: 'Kaam karo!',                hi: 'કામ કરો!',             url: '/sounds/kaam_karo.mp3' },
      { id: 'are_patav_aa',  label: 'Are patav aa mara vala!',   hi: 'અરે પટાવ આ!',          url: '/sounds/are_patav_aa.mp3' },
      { id: 'jaldi_karo',    label: 'Jaldi karo bhai!',          hi: 'જલ્દી કરો ભાઈ!',       url: '/sounds/jaldi_karo.mp3' },
      { id: 'shu_karo_cho',  label: 'Shu karo cho aakho divas?', hi: 'શું કરો છો આખો દિવસ?', url: '/sounds/shu_karo_cho.mp3' },
      { id: 'dhyan_rakho',   label: 'Dhyan rakho, task pending!',hi: 'ધ્યાન રાખો!',           url: '/sounds/dhyan_rakho.mp3' },
      { id: 'aavre_bhai',    label: 'Aavre bhai, kaam baaki!',   hi: 'આવ્રે ભાઈ!',           url: '/sounds/aavre_bhai.mp3' },
      { id: 'hu_thayu',      label: 'Hu thayu? Haji pending!',   hi: 'હું થયું?',             url: '/sounds/hu_thayu.mp3' },
    ],
  },
  {
    group: 'Hindi — Voice',
    hi: 'हिंदी आवाज़',
    sounds: [
      { id: 'hi_kaise_ho',        label: 'Kaise ho?',                  hi: 'कैसे हो?',              url: '/sounds/hi_kaise_ho.mp3' },
      { id: 'hi_kaam_karo',       label: 'Kaam karo!',                 hi: 'काम करो!',              url: '/sounds/hi_kaam_karo.mp3' },
      { id: 'hi_are_sun_bhai',    label: 'Are sun bhai, idhar aa!',    hi: 'अरे सुन भाई!',          url: '/sounds/hi_are_sun_bhai.mp3' },
      { id: 'hi_jaldi_karo',      label: 'Jaldi karo bhai!',           hi: 'जल्दी करो भाई!',        url: '/sounds/hi_jaldi_karo.mp3' },
      { id: 'hi_kya_karte_ho',    label: 'Kya karte ho poora din?',    hi: 'क्या करते हो पूरा दिन?', url: '/sounds/hi_kya_karte_ho.mp3' },
      { id: 'hi_dhyan_raho',      label: 'Dhyan raho, task pending!',  hi: 'ध्यान रहो!',            url: '/sounds/hi_dhyan_raho.mp3' },
      { id: 'hi_aao_bhai',        label: 'Aao bhai, kaam baaki hai!',  hi: 'आओ भाई!',               url: '/sounds/hi_aao_bhai.mp3' },
      { id: 'hi_kya_hua_pending', label: 'Kya hua? Abhi bhi pending!', hi: 'क्या हुआ?',             url: '/sounds/hi_kya_hua_pending.mp3' },
    ],
  },
  {
    group: 'Funny',
    hi: 'हास्य',
    sounds: [
      { id: 'jump',           label: 'Jump',           hi: 'कूद',       url: '/sounds/jump.mp3' },
      { id: 'mario',          label: 'Mario',          hi: 'मारियो',    url: '/sounds/mario.mp3' },
      { id: 'minion',         label: 'Minion',         hi: 'मिनियन',    url: '/sounds/minion.mp3' },
      { id: 'rooster',        label: 'Rooster',        hi: 'मुर्गा',    url: '/sounds/rooster.mp3' },
      { id: 'sad_trombone',   label: 'Sad trombone',   hi: 'उदास',      url: '/sounds/sad_trombone.mp3' },
      { id: 'windows_xp',    label: 'Windows XP',     hi: 'एरर',       url: '/sounds/windows_xp.mp3' },
      { id: 'vine_boom',      label: 'Vine boom',      hi: 'धमाका',     url: '/sounds/vine_boom.mp3' },
      { id: 'bruh',           label: 'Bruh',           hi: 'ब्रुह',     url: '/sounds/bruh.mp3' },
      { id: 'mlg_airhorn',    label: 'MLG airhorn',    hi: 'हॉर्न',     url: '/sounds/mlg_airhorn.mp3' },
      { id: 'crickets',       label: 'Crickets',       hi: 'झींगुर',    url: '/sounds/crickets.mp3' },
      { id: 'price_is_right', label: 'Price is Right', hi: 'हारे',      url: '/sounds/price_is_right.mp3' },
      { id: 'nyan_cat',       label: 'Nyan Cat',       hi: 'न्यान',     url: '/sounds/nyan_cat.mp3' },
      { id: 'among_us',       label: 'Among Us',       hi: 'इम्पोस्टर', url: '/sounds/among_us.mp3' },
      { id: 'discord',        label: 'Discord',        hi: 'डिस्कॉर्ड', url: '/sounds/discord.mp3' },
    ],
  },
  {
    group: 'Scary',
    hi: 'डरावना',
    sounds: [
      { id: 'halloween_organ', label: 'Halloween organ', hi: 'हैलोवीन', url: '/sounds/halloween_organ.mp3' },
      { id: 'heartbeat',       label: 'Heartbeat',       hi: 'दिल',     url: '/sounds/heartbeat.mp3' },
      { id: 'clock_alarm',     label: 'Clock alarm',     hi: 'अलार्म',  url: '/sounds/clock_alarm.mp3' },
    ],
  },
  {
    group: 'Gujju — Movie Dialogues',
    hi: 'ગુજ્જુ ફિલ્મ',
    sounds: [
      { id: 'pushpa_jhukse_nahi',  label: 'Jhukse nahi sala! 🌿',      hi: 'પુષ્પા',   url: '/sounds/pushpa_jhukse_nahi.mp3' },
      { id: 'sholay_tera_kaliya',  label: 'Taru shu thaase Kaliya?',   hi: 'શોલે',     url: '/sounds/sholay_tera_kaliya.mp3' },
      { id: 'singham_aata_majhi',  label: 'Have mari satki!',          hi: 'સિંઘમ',   url: '/sounds/singham_aata_majhi.mp3' },
      { id: '3idiots_all_is_well', label: 'All is well!',              hi: '3 Idiots', url: '/sounds/3idiots_all_is_well.mp3' },
      { id: '3idiots_balatkar',    label: 'Gyaan ni upasna karo!',     hi: '3 Idiots', url: '/sounds/3idiots_balatkar.mp3' },
      { id: 'golmaal_dhamaal',     label: 'Dhamaal masti Gujju style!',hi: 'ધમાલ',    url: '/sounds/golmaal_dhamaal.mp3' },
      { id: 'task_baaki',          label: 'Task pending, film pachi!', hi: 'ટાસ્ક',    url: '/sounds/task_baaki.mp3' },
    ],
  },
  {
    group: 'Hindi — Movie Dialogues',
    hi: 'हिंदी फ़िल्म',
    sounds: [
      { id: 'hi_pushpa_jhukenge_nahi', label: 'Jhukenge nahi sale! 🌿',         hi: 'पुष्पा',   url: '/sounds/hi_pushpa_jhukenge_nahi.mp3' },
      { id: 'hi_sholay_tera_kaliya',   label: 'Tera kya hoga, Kaliya?',         hi: 'शोले',     url: '/sounds/hi_sholay_tera_kaliya.mp3' },
      { id: 'hi_singham_satakli',      label: 'Aata majhi satakli!',            hi: 'सिंघम',   url: '/sounds/hi_singham_satakli.mp3' },
      { id: 'hi_3idiots_all_well',     label: 'All is well!',                   hi: '3 Idiots', url: '/sounds/hi_3idiots_all_well.mp3' },
      { id: 'hi_3idiots_gyaan',        label: 'Gyaan ki pooja karo!',           hi: '3 Idiots', url: '/sounds/hi_3idiots_gyaan.mp3' },
      { id: 'hi_golmaal_dhamaal',      label: 'Dhamaal masti Hindustani style!',hi: 'धमाल',    url: '/sounds/hi_golmaal_dhamaal.mp3' },
      { id: 'hi_task_pending',         label: 'Task pending, film baad mein!',  hi: 'टास्क',    url: '/sounds/hi_task_pending.mp3' },
    ],
  },
  {
    group: 'English Slang',
    hi: 'इंग्लिश स्लैंग',
    sounds: [
      { id: 'en_bruh',           label: 'Bruuuh...',               hi: 'ब्रुह',       url: '/sounds/en_bruh.mp3' },
      { id: 'en_cmon_man',       label: 'Come on man!',            hi: 'कम ऑन',       url: '/sounds/en_cmon_man.mp3' },
      { id: 'en_oh_my_god',      label: 'Oh my Goood!',            hi: 'ओह माय गॉड',  url: '/sounds/en_oh_my_god.mp3' },
      { id: 'en_are_you_serious','label': 'Are you serious?',      hi: 'सीरियस?',     url: '/sounds/en_are_you_serious.mp3' },
      { id: 'en_no_way',         label: 'No waaaay!',              hi: 'नो वे',       url: '/sounds/en_no_way.mp3' },
      { id: 'en_lets_gooo',      label: "Let's gooo!",             hi: 'लेट्स गो',    url: '/sounds/en_lets_gooo.mp3' },
      { id: 'en_sheesh',         label: 'Sheeeesh!',               hi: 'शीश',         url: '/sounds/en_sheesh.mp3' },
      { id: 'en_not_bad',        label: 'Not bad not bad!',        hi: 'नॉट बैड',     url: '/sounds/en_not_bad.mp3' },
      { id: 'en_you_got_this',   label: 'You got this bro!',       hi: 'यू गॉट दिस',  url: '/sounds/en_you_got_this.mp3' },
      { id: 'en_absolute_legend',label: 'Absolute legend!',        hi: 'लेजेंड',      url: '/sounds/en_absolute_legend.mp3' },
      { id: 'en_keep_grinding',  label: 'Keep grinding!',          hi: 'ग्राइंड',     url: '/sounds/en_keep_grinding.mp3' },
      { id: 'en_w_move',         label: 'That is a W move!',       hi: 'डब्लू मूव',   url: '/sounds/en_w_move.mp3' },
      { id: 'en_task_or_nap',    label: 'Task or nap? Task wins!', hi: 'टास्क',       url: '/sounds/en_task_or_nap.mp3' },
    ],
  },
];

// Flat list for lookups (playNotifSound, etc.)
export const NOTIF_SOUNDS = NOTIF_SOUND_GROUPS.flatMap(g => g.sounds);

const STORAGE_KEY = 'kv_notif_sound';
const DEFAULT_SOUND_ID = 'tabla';

export function getNotifSoundId() {
  try { return localStorage.getItem(STORAGE_KEY) || DEFAULT_SOUND_ID; } catch (_) { return DEFAULT_SOUND_ID; }
}

export function setNotifSoundId(id) {
  try { localStorage.setItem(STORAGE_KEY, id); } catch (_) {}
}

let cachedAudio = null;
let cachedUrl = null;

/**
 * Play a notification sound. Defaults to the stored preference; pass an id to
 * preview one directly.
 *
 * The explicit argument exists so a picker can play what was just clicked
 * without depending on having persisted it first — previewing a sound and
 * storing it are separate concerns, and coupling them made the preview play
 * the PREVIOUS selection whenever the caller ordered the two the other way.
 */
export function playNotifSound(explicitId) {
  const id = explicitId || getNotifSoundId();
  const sound = NOTIF_SOUNDS.find(s => s.id === id);
  if (!sound || !sound.url) return;
  try {
    if (cachedUrl !== sound.url) {
      cachedAudio = new Audio(sound.url);
      cachedUrl = sound.url;
    }
    cachedAudio.currentTime = 0;
    cachedAudio.volume = 0.5;
    cachedAudio.play().catch(() => {});
  } catch (_) {}
}

const PRAISE_SOUNDS = [
  // Gujju — male
  '/sounds/praise/kya_baat.mp3',
  '/sounds/praise/moje_moj.mp3',
  '/sounds/praise/wah_re_wah.mp3',
  '/sounds/praise/haakan_kevu.mp3',
  '/sounds/praise/shabash_bhai.mp3',
  '/sounds/praise/aapde_champion.mp3',
  '/sounds/praise/mast_kaam.mp3',
  '/sounds/praise/fatafat_kaam.mp3',
  '/sounds/praise/jai_kaam_thayu.mp3',
  '/sounds/praise/gujju_hero.mp3',
  // Gujju — female
  '/sounds/praise/f_kya_baat.mp3',
  '/sounds/praise/f_moje_moj.mp3',
  '/sounds/praise/f_wah_re_wah.mp3',
  '/sounds/praise/f_shabash_bhai.mp3',
  '/sounds/praise/f_aapde_champion.mp3',
  '/sounds/praise/f_mast_kaam.mp3',
  '/sounds/praise/f_fatafat_kaam.mp3',
  '/sounds/praise/f_gujju_hero.mp3',
  // Hindi — male
  '/sounds/praise/hi_kya_baat.mp3',
  '/sounds/praise/hi_wah_wah.mp3',
  '/sounds/praise/hi_shabash.mp3',
  '/sounds/praise/hi_kamaal.mp3',
  '/sounds/praise/hi_bahut_badhiya.mp3',
  '/sounds/praise/hi_champion.mp3',
  '/sounds/praise/hi_jai_ho.mp3',
  '/sounds/praise/hi_ekdum_mast.mp3',
  '/sounds/praise/hi_mast_hai.mp3',
  '/sounds/praise/hi_arey_waah.mp3',
  // Hindi — female
  '/sounds/praise/f_hi_kya_baat.mp3',
  '/sounds/praise/f_hi_wah_wah.mp3',
  '/sounds/praise/f_hi_shabash.mp3',
  '/sounds/praise/f_hi_bahut_badhiya.mp3',
  '/sounds/praise/f_hi_champion.mp3',
  '/sounds/praise/f_hi_ekdum_mast.mp3',
  '/sounds/praise/f_hi_jai_ho.mp3',
  '/sounds/praise/f_hi_arey_waah.mp3',
  // English — male
  '/sounds/praise/en_crushed_it.mp3',
  '/sounds/praise/en_legendary.mp3',
  '/sounds/praise/en_nailed_it.mp3',
  '/sounds/praise/en_you_beast.mp3',
  '/sounds/praise/en_you_the_og.mp3',
  '/sounds/praise/en_the_goat.mp3',
  '/sounds/praise/en_yeh_champion.mp3',
  // English — female
  '/sounds/praise/en_f_on_fire.mp3',
  '/sounds/praise/en_f_amazing_work.mp3',
  '/sounds/praise/en_f_killing_it.mp3',
  '/sounds/praise/en_f_proud_of_you.mp3',
  '/sounds/praise/en_f_you_the_og.mp3',
  '/sounds/praise/en_f_the_goat.mp3',
  '/sounds/praise/en_f_yeh_champion.mp3',
  // English — slang (reused from notif sounds)
  '/sounds/en_lets_gooo.mp3',
  '/sounds/en_sheesh.mp3',
  '/sounds/en_not_bad.mp3',
  '/sounds/en_absolute_legend.mp3',
  '/sounds/en_w_move.mp3',
];

export function playPraiseSound() {
  if (getNotifSoundId() === 'none') return;
  try {
    const url = PRAISE_SOUNDS[Math.floor(Math.random() * PRAISE_SOUNDS.length)];
    const audio = new Audio(url);
    audio.volume = 0.6;
    audio.play().catch(() => {});
  } catch (_) {}
}
