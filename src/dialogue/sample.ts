// Fixed bilingual dialogue for the explicit no-credentials sample mode (`npm run sample`).
import type { Dialogue } from '../../shared/types';

export const SAMPLE_DIALOGUE: Dialogue = {
  topic: 'Ordering iced coffee at a café',
  sceneId: 'cafe',
  lines: [
    {
      speaker: 'lupita',
      esMX: '¡Hola! ¿Me das un café helado, por favor?',
      ko: '안녕하세요! 아이스 커피 한 잔 주세요.',
      koPronunciation: 'an-nyeong-ha-se-yo! a-i-seu keo-pi han jan ju-se-yo.',
      gesture: 'wave',
    },
    {
      speaker: 'jisoo',
      esMX: '¡Claro! ¿De qué tamaño lo quieres?',
      ko: '네! 어떤 사이즈로 드릴까요?',
      koPronunciation: 'ne! eo-tteon sa-i-jeu-ro deu-ril-kka-yo?',
      gesture: 'nod',
    },
    {
      speaker: 'lupita',
      esMX: 'Mediano, por favor. ¿Tienen leche de avena?',
      ko: '중간 사이즈요. 귀리 우유 있어요?',
      koPronunciation: 'jung-gan sa-i-jeu-yo. gwi-ri u-yu i-sseo-yo?',
      gesture: 'tilt',
    },
    {
      speaker: 'jisoo',
      esMX: 'Sí, sí hay. Son cincuenta pesos.',
      ko: '네, 있어요. 오십 페소예요.',
      koPronunciation: 'ne, i-sseo-yo. o-sip pe-so-ye-yo.',
      gesture: 'nod',
    },
    {
      speaker: 'lupita',
      esMX: '¡Perfecto! ¿Puedo pagar con tarjeta?',
      ko: '좋아요! 카드로 계산해도 돼요?',
      koPronunciation: 'jo-a-yo! ka-deu-ro gye-san-hae-do dwae-yo?',
      gesture: 'none',
    },
    {
      speaker: 'jisoo',
      esMX: 'Ay, perdón. Hoy solo aceptamos efectivo.',
      ko: '아, 죄송해요. 오늘은 현금만 돼요.',
      koPronunciation: 'a, joe-song-hae-yo. o-neu-reun hyeon-geum-man dwae-yo.',
      gesture: 'shrug',
    },
  ],
};

/** Fixed non-café sample (`npm run sample:park`) used to verify scene consistency across sections. */
export const SAMPLE_DIALOGUE_PARK: Dialogue = {
  topic: 'Making weekend plans in the park',
  sceneId: 'park',
  lines: [
    {
      speaker: 'jisoo',
      esMX: '¡Hola, Lupita! ¿Qué vas a hacer el sábado?',
      ko: '안녕, 루피타! 토요일에 뭐 해?',
      koPronunciation: 'an-nyeong, ru-pi-ta! to-yo-i-re mwo hae?',
      gesture: 'wave',
    },
    {
      speaker: 'lupita',
      esMX: 'Nada todavía. ¿Quieres ir al mercado?',
      ko: '아직 없어. 시장에 갈래?',
      koPronunciation: 'a-jik eop-seo. si-jang-e gal-lae?',
      gesture: 'tilt',
    },
    {
      speaker: 'jisoo',
      esMX: '¡Sí, qué padre! ¿A qué hora nos vemos?',
      ko: '좋아, 재밌겠다! 몇 시에 만날까?',
      koPronunciation: 'jo-a, jae-mit-get-da! myeot si-e man-nal-kka?',
      gesture: 'nod',
    },
    {
      speaker: 'lupita',
      esMX: 'Como a las diez, aquí en el parque.',
      ko: '열 시쯤, 여기 공원에서.',
      koPronunciation: 'yeol si-jjeum, yeo-gi gong-won-e-seo.',
      gesture: 'none',
    },
    {
      speaker: 'jisoo',
      esMX: '¿Y si llueve? No sé qué va a pasar.',
      ko: '비 오면? 어떻게 될지 모르겠어.',
      koPronunciation: 'bi o-myeon? eo-tteo-ke doel-ji mo-reu-ge-sseo.',
      gesture: 'shrug',
    },
    {
      speaker: 'lupita',
      esMX: 'Entonces vamos a un café. ¡Nos vemos!',
      ko: '그럼 카페에 가자. 그때 봐!',
      koPronunciation: 'geu-reom ka-pe-e ga-ja. geu-ttae bwa!',
      gesture: 'wave',
    },
  ],
};

export const SAMPLES: Record<string, Dialogue> = { cafe: SAMPLE_DIALOGUE, park: SAMPLE_DIALOGUE_PARK };
