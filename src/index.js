import { loadConfig } from './config.js';
import { logger } from './logger.js';
import { fetchPendingApprovals } from './ecountScraper.js';
import { refreshAccessToken, sendKakaoMemo } from './kakaoNotifier.js';

// 카카오 "나에게 보내기" text 템플릿은 길이 제한이 있어, 넉넉히 여유를 두고 나눠 보낸다.
const MAX_CHARS = 180;

function todayLabelKST() {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function buildMessages(items, dateLabel) {
  const header = `📋 이카운트 결재 대기 (${dateLabel}${items.length ? `, 총 ${items.length}건` : ''})`;

  if (items.length === 0) {
    return [`${header}\n오늘은 결재 대기 문서가 없습니다.`];
  }

  const lines = items.map((it, i) => `${i + 1}. [${it.date}] ${it.title} - ${it.drafter}`);
  const pages = [];
  let current = [];
  let currentLen = header.length;

  for (const line of lines) {
    if (current.length > 0 && currentLen + line.length + 1 > MAX_CHARS) {
      pages.push(current);
      current = [];
      currentLen = header.length;
    }
    current.push(line);
    currentLen += line.length + 1;
  }
  if (current.length) pages.push(current);

  return pages.map((page, idx) => {
    const suffix = pages.length > 1 ? ` (${idx + 1}/${pages.length})` : '';
    return `${header}${suffix}\n${page.join('\n')}`;
  });
}

async function main() {
  const config = loadConfig();

  let items;
  try {
    items = await fetchPendingApprovals(config, logger);
  } catch (err) {
    logger.error('이카운트 미결재 목록 수집 실패:', err.message);
    process.exitCode = 1;
    return;
  }

  let accessToken;
  let refreshWarning = '';
  try {
    const { accessToken: token, newRefreshToken } = await refreshAccessToken(config.kakao);
    accessToken = token;
    if (newRefreshToken && newRefreshToken !== config.kakao.refreshToken) {
      logger.warn('카카오 refresh_token이 새로 발급되었습니다. KAKAO_REFRESH_TOKEN 시크릿을 아래 값으로 업데이트하세요.');
      logger.warn(`NEW_REFRESH_TOKEN=${newRefreshToken}`);
      refreshWarning = '\n\n⚠️ 카카오 refresh_token이 갱신되었습니다. 실행 로그를 확인해 시크릿을 업데이트해주세요.';
    }
  } catch (err) {
    logger.error('카카오 토큰 갱신 실패:', err.message);
    process.exitCode = 1;
    return;
  }

  const messages = buildMessages(items, todayLabelKST());
  if (refreshWarning) {
    messages[messages.length - 1] += refreshWarning;
  }

  for (const [i, msg] of messages.entries()) {
    try {
      await sendKakaoMemo(accessToken, msg);
      logger.info(`카카오 메시지 전송 완료 (${i + 1}/${messages.length})`);
    } catch (err) {
      logger.error('카카오 메시지 전송 실패:', err.message);
      process.exitCode = 1;
      return;
    }
  }

  logger.info(`완료: 결재 대기 ${items.length}건 처리`);
}

main().catch((err) => {
  logger.error('예상치 못한 오류:', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
