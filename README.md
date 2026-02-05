# Sunshade (skeleton)

Minimal Electron 뼈대입니다. 아직 PDF 분석/LLM 호출 로직은 없습니다.

## 구성
- `main.js`: Electron 진입점, 창 생성, IPC 라우팅.
- `preload.js`: 렌더러에서 사용할 `sunshadeAPI` 브리지.
- `renderer/`: Moonlight-style 정적 UI + pdf.js 렌더링(드래그/클릭 로드).
- `src/auth/google.js`: Google OAuth(PKCE, loopback) 로그인 + keytar 저장/리프레시.
- `.env.example`: Google OAuth 클라이언트 설정 예시.
- `src/llm/gemini.js`: Gemini 호출 스켈레톤.

## 실행
1) Google Cloud 콘솔에서 OAuth 클라이언트(데스크톱 앱) 생성 후 `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`를 설정:
   ```bash
   cp .env.example .env
   # .env 파일에 값 채우기
   ```
2) 의존성 설치:
   ```bash
   npm install
   ```
3) 앱 실행:
   ```bash
   npm start
   ```

## 다음 단계 제안
- keytar 등으로 토큰을 OS Keychain에 저장하고 리프레시 로직 추가.
- PDF 파서/요약 워커 추가(pdf.js + 임베딩 파이프라인).
- OpenAI 로그인 계획은 제외하고 Google OAuth만 사용합니다.
