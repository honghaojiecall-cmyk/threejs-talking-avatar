import { pinyin } from 'pinyin-pro';

const INITIALS_ORDERED = [
  'zh', 'ch', 'sh',
  'b', 'p', 'm', 'f', 'd', 't', 'n', 'l',
  'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w',
] as const;

const INITIAL_IPA: Record<string, string> = {
  zh: 'tʂ', ch: 'tʂʰ', sh: 'ʂ', r: 'ɻ',
  z: 'ts', c: 'tsʰ', s: 's',
  j: 'tɕ', q: 'tɕʰ', x: 'ɕ',
  b: 'p', p: 'pʰ', m: 'm', f: 'f',
  d: 't', t: 'tʰ', n: 'n', l: 'l',
  g: 'k', k: 'kʰ', h: 'x',
  y: 'j', w: 'w',
};

const FINAL_IPA: Record<string, string> = {
  a: 'a', o: 'o', e: 'ɤ', i: 'i', u: 'u', v: 'y',
  ai: 'aɪ', ei: 'eɪ', ao: 'ɑʊ', ou: 'oʊ',
  an: 'a n', en: 'ə n', ang: 'a ŋ', eng: 'ə ŋ', ong: 'ʊ ŋ', er: 'ɚ',
  ia: 'i a', ie: 'i ɛ', iao: 'i ɑʊ', iu: 'i oʊ',
  ian: 'i ɛ n', in: 'i n', iang: 'i a ŋ', ing: 'i ŋ', iong: 'i ʊ ŋ',
  ua: 'u a', uo: 'u o', uai: 'u aɪ', ui: 'u eɪ',
  uan: 'u a n', un: 'u ə n', uang: 'u a ŋ', ueng: 'u ə ŋ',
  ve: 'y ɛ', van: 'y ɛ n', vn: 'y n',
};

const CJK_PATTERN = /[㐀-鿿豈-﫿]/u;

function syllableToIpa(rawSyllable: string): string {
  const syllable = rawSyllable.toLowerCase().replace(/ü/gu, 'v');
  if (!/^[a-zv]+$/u.test(syllable)) return '';

  let initial = '';
  for (const candidate of INITIALS_ORDERED) {
    if (syllable.startsWith(candidate)) {
      initial = candidate;
      break;
    }
  }
  let final = syllable.slice(initial.length);

  if (['j', 'q', 'x', 'y'].includes(initial)) {
    if (final.startsWith('uan')) final = `van${final.slice(3)}`;
    else if (final.startsWith('ue')) final = `ve${final.slice(2)}`;
    else if (final.startsWith('un')) final = `vn${final.slice(2)}`;
    else if (final.startsWith('u')) final = `v${final.slice(1)}`;
  }

  const finalPhones = FINAL_IPA[final] ?? 'ə';
  const initialPhone = initial ? INITIAL_IPA[initial] : '';
  return initialPhone ? `${initialPhone} ${finalPhones}` : finalPhones;
}

/**
 * Builds an approximate IPA phone track for Mandarin text so the generic
 * duration-based lip-timing pipeline can articulate a Piper Chinese voice.
 * Each syllable becomes one onset+nucleus group; CJK punctuation is mapped
 * to the ASCII pauses the tokenizer already understands.
 */
export function chineseTextToIpa(text: string): string {
  const groups: string[] = [];
  let index = 0;
  while (index < text.length) {
    const character = text[index];
    if (CJK_PATTERN.test(character)) {
      const [syllable = ''] = pinyin(character, {
        toneType: 'none',
        type: 'array',
        v: true,
      });
      const phones = syllableToIpa(syllable);
      if (phones) groups.push(phones);
      index += 1;
      continue;
    }
    if (/[a-zA-Z]/u.test(character)) {
      let end = index;
      while (end < text.length && /[a-zA-Z]/u.test(text[end])) end += 1;
      groups.push(text.slice(index, end));
      index = end;
      continue;
    }
    if ('。！？!?'.includes(character)) groups.push('.');
    else if ('，、；：,;—–…'.includes(character)) groups.push(',');
    index += 1;
  }
  return groups.join(' ');
}
