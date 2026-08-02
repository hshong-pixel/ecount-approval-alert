import { chromium } from 'playwright';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

// 로그인 후 클릭 순서: 그룹웨어 탭 -> 전자결재 서브탭 -> 기안서통합관리(좌측 메뉴) -> 진행중 탭
const NAV_STEPS = ['그룹웨어', '전자결재', '기안서통합관리', '진행중'];

// 로그인 직후에는 중간 처리 페이지(erp_login_processor 등)를 거쳐 대시보드가 늦게 렌더링될 수 있어,
// 단발성 시도 대신 지정한 시간 동안 프레임들을 반복 폴링하며 클릭을 시도한다.
async function clickTextInAnyFrame(page, text, timeoutMs = 20000) {
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeoutMs) {
    for (const frame of page.frames()) {
      try {
        const locator = frame.getByText(text, { exact: true }).first();
        await locator.click({ timeout: 1500 });
        return frame;
      } catch (err) {
        lastErr = err;
      }
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`"${text}" 메뉴/탭 요소를 화면에서 찾지 못했습니다 (${timeoutMs}ms 대기). Ecount 화면 구조가 변경되었을 수 있습니다.`);
}

// 브라우저 컨텍스트 안에서 실행되는 함수 (DOM 직접 접근)
function extractorInPage(approverName) {
  function normalize(s) {
    return (s || '').replace(/\s+/g, ' ').trim();
  }
  const tables = Array.from(document.querySelectorAll('table'));
  for (const table of tables) {
    const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
    if (!headerRow) continue;
    const headerCells = Array.from(headerRow.querySelectorAll('th, td')).map((c) => normalize(c.innerText));
    if (!headerCells.includes('기안자') || !headerCells.includes('제목') || !headerCells.includes('결재자')) {
      continue;
    }

    const colIndex = (label) => headerCells.indexOf(label);
    const dateIdx = colIndex('기안일자');
    const titleIdx = colIndex('제목');
    const drafterIdx = colIndex('기안자');
    const approverIdx = colIndex('결재자');

    const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
    const all = [];
    for (const tr of bodyRows) {
      const cells = Array.from(tr.querySelectorAll('td'));
      if (!cells.length) continue;
      const get = (i) => (i >= 0 && cells[i] ? normalize(cells[i].innerText) : '');
      all.push({
        date: get(dateIdx),
        title: get(titleIdx),
        drafter: get(drafterIdx),
        approver: get(approverIdx),
      });
    }

    const rows = approverName ? all.filter((r) => r.approver === approverName) : all;
    return { found: true, totalCount: all.length, rows };
  }
  return { found: false };
}

async function saveDebugArtifacts(page, logger, networkLog) {
  const dir = path.join(process.cwd(), 'debug-artifacts');
  await mkdir(dir, { recursive: true });
  const screenshotPath = path.join(dir, 'failure.png');
  const htmlPath = path.join(dir, 'failure.html');
  const logPath = path.join(dir, 'network-console.log');
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  const html = await page.content().catch(() => '');
  await writeFile(htmlPath, html, 'utf8').catch(() => {});
  await writeFile(logPath, (networkLog || []).join('\n'), 'utf8').catch(() => {});
  logger.warn(`디버그용 스크린샷/HTML/로그 저장됨: ${screenshotPath}, ${htmlPath}, ${logPath} (Actions 아티팩트로 업로드됨)`);
}

async function findApprovalTable(page, approverName, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const frame of page.frames()) {
      try {
        const res = await frame.evaluate(extractorInPage, approverName);
        if (res && res.found) return res;
      } catch (err) {
        // detached/cross-origin 프레임은 건너뜀
      }
    }
    await page.waitForTimeout(500);
  }
  return { found: false };
}

export async function fetchPendingApprovals(config, logger) {
  const browser = await chromium.launch({ headless: true });
  let page;
  const networkLog = [];
  try {
    const context = await browser.newContext({
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      extraHTTPHeaders: { 'Accept-Language': 'ko-KR,ko;q=0.9' },
    });
    page = await context.newPage();
    // 중복 로그인 등 confirm/alert 팝업이 뜨면 자동으로 수락 (헤드리스 실행이라 사람이 클릭할 수 없음)
    page.on('dialog', (dialog) => {
      networkLog.push(`[dialog] type=${dialog.type()} message=${dialog.message()}`);
      dialog.accept().catch(() => {});
    });
    page.on('console', (msg) => networkLog.push(`[console:${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => networkLog.push(`[pageerror] ${err.message}`));
    page.on('request', (req) => {
      if (req.method() === 'POST' || /login|auth|save/i.test(req.url())) {
        networkLog.push(`[request] ${req.method()} ${req.url()}`);
      }
    });
    page.on('response', async (response) => {
      const req = response.request();
      if (req.method() === 'POST' || /login|auth|save/i.test(response.url())) {
        const bodySnippet = await response.text().catch(() => '(body unavailable)');
        networkLog.push(`[response] status=${response.status()} url=${response.url()} body=${bodySnippet.slice(0, 500)}`);
      }
    });

    logger.info('이카운트 로그인 페이지 접속 중');
    await page.goto(config.loginUrl, { waitUntil: 'domcontentloaded' });

    // 이 로그인 폼은 #save가 type="button"이라 자체 제출 기능이 없고, 자바스크립트가 keyup 등
    // 키 입력 이벤트로 "입력 완료"를 감지해 클릭을 처리하는 구조로 보인다. fill()은 값만 넣고
    // 키 이벤트를 발생시키지 않아 클릭이 무시될 수 있어, 실제 타이핑처럼 한 글자씩 입력한다.
    await page.locator('#com_code').pressSequentially(config.comCode, { delay: 30 });
    await page.locator('#id').pressSequentially(config.id, { delay: 30 });
    await page.locator('#passwd').pressSequentially(config.password, { delay: 30 });
    await page.click('#save');

    try {
      await page.waitForFunction(() => !location.href.includes('login.ecount.com'), { timeout: 30000 });
    } catch (err) {
      const bodyText = await page.textContent('body').catch(() => '');
      throw new Error(
        `로그인 실패 또는 응답 시간 초과 (현재 URL: ${page.url()}). 화면 내용 일부: ${(bodyText || '').slice(0, 300)}. 네트워크/콘솔 로그: ${networkLog.join(' | ')}`
      );
    }
    logger.info(`로그인 성공 (이동된 URL: ${page.url()})`);

    for (const step of NAV_STEPS) {
      await clickTextInAnyFrame(page, step);
      logger.info(`"${step}" 클릭 완료`);
      await page.waitForTimeout(1000);
    }

    logger.info('미결재 목록 테이블 탐색 중');
    const result = await findApprovalTable(page, config.approverName);
    if (!result.found) {
      throw new Error('기안서통합관리 화면에서 목록 테이블을 찾지 못했습니다. 화면 구조가 변경되었을 수 있습니다.');
    }

    logger.info(`전체 ${result.totalCount}건 중 결재자="${config.approverName}" 필터 후 ${result.rows.length}건`);
    return result.rows;
  } catch (err) {
    if (page) {
      await saveDebugArtifacts(page, logger, networkLog);
    }
    throw err;
  } finally {
    await browser.close().catch(() => {});
  }
}
