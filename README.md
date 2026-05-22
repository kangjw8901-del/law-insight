# 노동법령 알림 서비스 - 설치 및 배포 가이드

## 📁 폴더 구조
```
labor-law-app/
├── server.js          ← 백엔드 서버 (Node.js)
├── package.json       ← 패키지 목록
├── .env.example       ← 환경변수 예시 (복사해서 .env로 만드세요)
└── public/
    └── index.html     ← 웹 화면
```

---

## 🖥️ 로컬에서 먼저 테스트하기

### 1단계: 폴더 열기
명령 프롬프트에서 아래 입력:
```
cd labor-law-app
```

### 2단계: 패키지 설치
```
npm install
```

### 3단계: 환경변수 파일 만들기
`.env.example` 파일을 복사해서 `.env`로 이름 변경 후 내용 수정:
```
LAW_API_KEY=발급받은_API키_입력
SMTP_USER=Gmail주소@gmail.com
SMTP_PASS=Gmail_앱비밀번호
MEMBER1_EMAIL=팀원1@example.com
MEMBER2_EMAIL=팀원2@example.com
```

> **Gmail 앱 비밀번호 만들기:**
> Google 계정 → 보안 → 2단계 인증 활성화 → 앱 비밀번호 생성

### 4단계: 서버 실행
```
npm start
```

### 5단계: 브라우저에서 확인
```
http://localhost:3000
```

---

## 🌐 인터넷에 배포하기 (Render - 무료)

### 1단계: GitHub에 코드 올리기
1. https://github.com 에서 새 저장소(Repository) 만들기
2. 이 폴더의 파일들을 업로드

### 2단계: Render 가입 및 배포
1. https://render.com 접속 → GitHub으로 로그인
2. "New +" → "Web Service" 클릭
3. GitHub 저장소 연결
4. 설정:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. "Environment" 탭에서 환경변수 입력:
   - `LAW_API_KEY` = 발급받은 API 키
   - `SMTP_USER` = Gmail 주소
   - `SMTP_PASS` = 앱 비밀번호
   - `MEMBER1_EMAIL` ~ `MEMBER5_EMAIL` = 팀원 이메일들
6. "Deploy" 클릭

배포 완료 후 `https://[프로젝트명].onrender.com` 주소로 접속 가능!

---

## 📧 이메일 알림 동작 방식
- **매일 오전 9시** 자동으로 법제처 API 호출
- 전날 이후 개정된 근로 관련 법령 확인
- 변경사항 있으면 팀원 전체에게 이메일 발송

---

## ❓ 자주 묻는 질문

**Q: API 키를 어디서 받나요?**
A: https://www.law.go.kr/LSO/openApi/introduce.do 접속 → 신청

**Q: 무료로 운영 가능한가요?**
A: Render 무료 플랜으로 소규모 팀 사용 가능 (월 750시간 무료)

**Q: 팀원 추가는 어떻게 하나요?**
A: 웹 화면 → "팀원 관리" 탭에서 이름/이메일 입력 후 추가
