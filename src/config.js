import 'dotenv/config';

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`환경변수 ${name} 가(이) 설정되지 않았습니다.`);
  }
  return value;
}

export function loadConfig() {
  return {
    loginUrl: process.env.ECOUNT_LOGIN_URL || 'https://login.ecount.com',
    comCode: required('ECOUNT_COM_CODE'),
    id: required('ECOUNT_ID'),
    password: required('ECOUNT_PASSWORD'),
    approverName: process.env.ECOUNT_APPROVER_NAME || '김대희',
    kakao: {
      restApiKey: required('KAKAO_REST_API_KEY'),
      refreshToken: required('KAKAO_REFRESH_TOKEN'),
      clientSecret: process.env.KAKAO_CLIENT_SECRET || undefined,
    },
  };
}
