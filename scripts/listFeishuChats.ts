import "dotenv/config";

type TokenResponse = {
  code?: number;
  msg?: string;
  tenant_access_token?: string;
};

type ChatListResponse = {
  code?: number;
  msg?: string;
  data?: {
    items?: Array<{
      chat_id?: string;
      name?: string;
      chat_status?: string;
    }>;
  };
};

const appId = (process.env.FEISHU_APP_ID || "").trim();
const appSecret = (process.env.FEISHU_APP_SECRET || "").trim();

if (!appId || !appSecret) {
  console.error("未配置 FEISHU_APP_ID / FEISHU_APP_SECRET");
  process.exitCode = 1;
} else {
  const tokenResponse = await fetch(
    "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
    {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    },
  );
  const token = (await tokenResponse.json()) as TokenResponse;
  if (!tokenResponse.ok || token.code !== 0 || !token.tenant_access_token) {
    console.error(`获取飞书凭证失败：${token.msg || token.code}`);
    process.exitCode = 1;
  } else {
    const response = await fetch(
      "https://open.feishu.cn/open-apis/im/v1/chats?page_size=100",
      {
        headers: {
          Authorization: `Bearer ${token.tenant_access_token}`,
        },
      },
    );
    const payload = (await response.json()) as ChatListResponse;
    if (!response.ok || payload.code !== 0) {
      console.error(`读取飞书群列表失败：${payload.msg || payload.code}`);
      process.exitCode = 1;
    } else {
      const chats = payload.data?.items ?? [];
      if (chats.length === 0) {
        console.log("应用机器人当前不在任何可见群聊中。");
      } else {
        console.table(
          chats.map((chat) => ({
            群名称: chat.name || "(未命名)",
            chat_id: chat.chat_id || "",
            状态: chat.chat_status || "",
          })),
        );
      }
    }
  }
}
