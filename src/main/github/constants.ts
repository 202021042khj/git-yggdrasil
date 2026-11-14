// GitHub OAuth App (Device Flow). Client ID 는 공개 값이다. 다른 앱으로 시험하려면 YGG_GH_CLIENT_ID 로 바꾼다.
export const GH_CLIENT_ID = process.env.YGG_GH_CLIENT_ID || "Ov23liCTALlDkudn2YA3";
export const GH_SCOPE = "repo read:user";
export const GH_USER_AGENT = "Git-Yggdrasil";
export const GH_API = "https://api.github.com";
