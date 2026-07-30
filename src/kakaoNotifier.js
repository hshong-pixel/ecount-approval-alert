const TOKEN_URL = 'https://kauth.kakao.com/oauth/token';
const MEMO_URL = 'https://kapi.kakao.com/v2/api/talk/memo/default/send';

export async function refreshAccessToken({ restApiKey, refreshToken, clientSecret }) {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: restApiKey,
    refresh_token: refreshToken,
  });
  if (clientSecret) params.set('client_secret', clientSecret);

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: params.toString(),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`카카오 토큰 갱신 실패 (${res.status}): ${JSON.stringify(data)}`);
  }

  return {
    accessToken: data.access_token,
    // Kakao는 리프레시 토큰 만료가 임박한 경우에만 새 refresh_token을 내려줌 (평소엔 없음)
    newRefreshToken: data.refresh_token || null,
  };
}

export async function sendKakaoMemo(accessToken, text) {
  const templateObject = {
    object_type: 'text',
    text,
    link: { web_url: 'https://login.ecount.com', mobile_web_url: 'https://login.ecount.com' },
  };
  const params = new URLSearchParams({ template_object: JSON.stringify(templateObject) });

  const res = await fetch(MEMO_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
    },
    body: params.toString(),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.result_code !== 0) {
    throw new Error(`카카오 메시지 전송 실패 (${res.status}): ${JSON.stringify(data)}`);
  }
  return data;
}
