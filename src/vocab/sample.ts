// Fixed word list for the no-credentials sample (`npm run sample:vocab`) and tests.
import type { VocabList } from '../../shared/types';

export const SAMPLE_VOCAB: VocabList = {
  topic: 'Fruits',
  hashtags: ['Fruits', 'Frutas', 'Vocabulary'],
  words: [
    { esMX: 'la manzana', ko: '사과', koPronunciation: 'sa-gwa', en: 'apple', wikiTitle: 'Apple', imageQuery: 'red apple' },
    { esMX: 'el plátano', ko: '바나나', koPronunciation: 'ba-na-na', en: 'banana', wikiTitle: 'Banana', imageQuery: 'banana fruit' },
    { esMX: 'la naranja', ko: '오렌지', koPronunciation: 'o-ren-ji', en: 'orange', wikiTitle: 'Orange (fruit)', imageQuery: 'orange fruit' },
    { esMX: 'la sandía', ko: '수박', koPronunciation: 'su-bak', en: 'watermelon', wikiTitle: 'Watermelon', imageQuery: 'watermelon slice' },
    { esMX: 'las uvas', ko: '포도', koPronunciation: 'po-do', en: 'grapes', wikiTitle: 'Grape', imageQuery: 'grapes bunch' },
    { esMX: 'la fresa', ko: '딸기', koPronunciation: 'ttal-gi', en: 'strawberry', wikiTitle: 'Strawberry', imageQuery: 'strawberry' },
    { esMX: 'el mango', ko: '망고', koPronunciation: 'mang-go', en: 'mango', wikiTitle: 'Mango', imageQuery: 'mango fruit' },
    { esMX: 'la piña', ko: '파인애플', koPronunciation: 'pa-i-nae-peul', en: 'pineapple', wikiTitle: 'Pineapple', imageQuery: 'pineapple' },
    { esMX: 'el limón', ko: '라임', koPronunciation: 'ra-im', en: 'lime', wikiTitle: 'Lime (fruit)', imageQuery: 'green lime' },
    { esMX: 'el aguacate', ko: '아보카도', koPronunciation: 'a-bo-ka-do', en: 'avocado', wikiTitle: 'Avocado', imageQuery: 'avocado' },
  ],
};
