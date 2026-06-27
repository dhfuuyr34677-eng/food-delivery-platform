// WeChat Mini Program API wrapper
// Uses WeChat code-to-session endpoint to get openid + session_key

interface WechatSession {
  openid: string;
  session_key: string;
  unionid?: string;
}

export async function codeToSession(code: string): Promise<WechatSession> {
  const appId = process.env.WECHAT_APP_ID;
  const appSecret = process.env.WECHAT_APP_SECRET;

  if (!appId || !appSecret) {
    // Dev mode: return mock session for testing
    console.warn(
      '[WeChat] WECHAT_APP_ID or WECHAT_APP_SECRET not set, using mock',
    );
    return {
      openid: `mock_openid_${code}`,
      session_key: `mock_session_${code}`,
    };
  }

  const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${appId}&secret=${appSecret}&js_code=${code}&grant_type=authorization_code`;

  const res = await fetch(url);
  const data = (await res.json()) as any;

  if (data.errcode) {
    throw new Error(`WeChat error ${data.errcode}: ${data.errmsg}`);
  }

  return {
    openid: data.openid,
    session_key: data.session_key,
    unionid: data.unionid,
  };
}
