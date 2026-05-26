const express = require('express');
const axios = require('axios');
const cors = require('cors');
const cron = require('node-cron');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const API_KEY = process.env.LAW_API_KEY;
const BASE = 'https://www.law.go.kr/DRF';

// ─────────────────────────────────────────────────────────
// 데이터 저장 (JSON 파일로 영속화)
// ─────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const DATA_FILE = path.join(__dirname, 'data.json');

let dataStore = {
  members: [
    { name: '강중원', email: process.env.MEMBER1_EMAIL || '', active: true, role: 'admin', personalKeywords: [] },
    { name: '팀원2',  email: process.env.MEMBER2_EMAIL || '', active: true, role: 'member', personalKeywords: [] },
  ],
  commonKeywords: ['개인정보', '최저임금', '부동산', '세금'],
  alertHistory: [],
  lastCheckedDate: new Date().toISOString().slice(0,10).replace(/-/g,''),
};

// 파일에서 데이터 로드
function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf-8');
      const loaded = JSON.parse(raw);
      dataStore = { ...dataStore, ...loaded };
      console.log('✅ 데이터 로드 완료:', DATA_FILE);
    } else {
      saveData();
      console.log('✅ 초기 데이터 파일 생성:', DATA_FILE);
    }
  } catch (err) {
    console.error('데이터 로드 오류:', err.message);
  }
}

// 파일에 데이터 저장
function saveData() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(dataStore, null, 2), 'utf-8');
  } catch (err) {
    console.error('데이터 저장 오류:', err.message);
  }
}

loadData();

// 기존 코드 호환용 (다른 함수에서 사용)
let members = dataStore.members;
let lastCheckedDate = dataStore.lastCheckedDate;

// ─────────────────────────────────────────────────────────
// 공인노무사 시험 범위 법령 (검색 한정 범위)
// 노동법(1), 노동법(2), 민법, 사회보험법 + 고용노동부 소관 법령 전반
// ─────────────────────────────────────────────────────────
const ALLOWED_LAWS = [
  // 노동법(1)
  { name: '근로기준법', category: '노동법(1)' },
  { name: '파견근로자 보호 등에 관한 법률', category: '노동법(1)' },
  { name: '기간제 및 단시간근로자 보호 등에 관한 법률', category: '노동법(1)' },
  { name: '산업안전보건법', category: '노동법(1)' },
  { name: '직업안정법', category: '노동법(1)' },
  { name: '남녀고용평등', category: '노동법(1)' },
  { name: '최저임금법', category: '노동법(1)' },
  { name: '근로자퇴직급여 보장법', category: '노동법(1)' },
  { name: '임금채권보장법', category: '노동법(1)' },
  { name: '근로복지기본법', category: '노동법(1)' },
  { name: '외국인근로자의 고용 등에 관한 법률', category: '노동법(1)' },

  // 노동법(2)
  { name: '노동조합 및 노동관계조정법', category: '노동법(2)' },
  { name: '근로자참여 및 협력증진에 관한 법률', category: '노동법(2)' },
  { name: '노동위원회법', category: '노동법(2)' },
  { name: '공무원의 노동조합 설립 및 운영 등에 관한 법률', category: '노동법(2)' },
  { name: '교원의 노동조합 설립 및 운영 등에 관한 법률', category: '노동법(2)' },

  // 민법
  { name: '민법', category: '민법' },

  // 사회보험법
  { name: '사회보장기본법', category: '사회보험법' },
  { name: '고용보험법', category: '사회보험법' },
  { name: '산업재해보상보험법', category: '사회보험법' },
  { name: '국민연금법', category: '사회보험법' },
  { name: '국민건강보험법', category: '사회보험법' },
  { name: '고용보험 및 산업재해보상보험의 보험료징수 등에 관한 법률', category: '사회보험법' },

  // 기타 노동·고용 관련 법령
  { name: '근로자의 날', category: '기타 노동법령' },
  { name: '노동절', category: '기타 노동법령' },
  { name: '중대재해 처벌 등에 관한 법률', category: '기타 노동법령' },
  { name: '중대재해처벌법', category: '기타 노동법령' },
  { name: '근로자직업능력 개발법', category: '기타 노동법령' },
  { name: '국민 평생 직업능력 개발법', category: '기타 노동법령' },
  { name: '고용상 연령차별금지 및 고령자고용촉진에 관한 법률', category: '기타 노동법령' },
  { name: '장애인고용촉진 및 직업재활법', category: '기타 노동법령' },
  { name: '청년고용촉진 특별법', category: '기타 노동법령' },
  { name: '건설근로자의 고용개선 등에 관한 법률', category: '기타 노동법령' },
  { name: '가사근로자의 고용개선 등에 관한 법률', category: '기타 노동법령' },
  { name: '진폐의 예방과 진폐근로자의 보호 등에 관한 법률', category: '기타 노동법령' },
  { name: '직장 내 괴롭힘', category: '기타 노동법령' },
];

// 소관부처가 고용노동부면 화이트리스트에 없어도 통과 (포괄적 검색)
const ALLOWED_DEPTS = ['고용노동부', '근로복지공단', '중앙노동위원회', '최저임금위원회'];

// 법령명이 허용 목록에 포함되는지 검사
function isAllowedLaw(lawName, dept = '') {
  if (!lawName) return false;

  // 1) 화이트리스트 법령명 일치
  const nameMatch = ALLOWED_LAWS.some(allowed => {
    const key = allowed.name.replace(/\s+/g, '');
    const target = lawName.replace(/\s+/g, '');
    return target.includes(key);
  });
  if (nameMatch) return true;

  // 2) 소관부처가 고용노동부 계열이면 통과
  if (dept) {
    const deptClean = dept.replace(/\s+/g, '');
    return ALLOWED_DEPTS.some(d => deptClean.includes(d));
  }
  return false;
}

// 법령에 카테고리 부여
function getCategoryFor(lawName, dept = '') {
  if (!lawName) return '';
  const target = lawName.replace(/\s+/g, '');

  // 1) 화이트리스트 매칭
  const found = ALLOWED_LAWS.find(allowed => {
    const key = allowed.name.replace(/\s+/g, '');
    return target.includes(key);
  });
  if (found) return found.category;

  // 2) 고용노동부 소관이면 '기타 노동법령'
  if (dept) {
    const deptClean = dept.replace(/\s+/g, '');
    if (ALLOWED_DEPTS.some(d => deptClean.includes(d))) {
      return '기타 노동법령';
    }
  }
  return '';
}

// ─────────────────────────────────────────────────────────
// 동의어 사전 - 사용자 입력 -> 실제 법령 내 표현 확장
// 한 단어 검색이 들어오면 관련된 모든 표현을 함께 매칭
// 사전에 없는 키워드는 입력 그대로 검색됨 (전 분야 법령 대상)
// ─────────────────────────────────────────────────────────
const SYNONYMS = {
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 1. 사직 / 퇴직 / 이직
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  '권고사직':       ['권고사직', '권고 사직', '사직 권고', '퇴직 권유', '퇴직권유', '의원면직', '해고'],
  '권고 사직':     ['권고사직', '권고 사직', '사직 권고', '퇴직 권유', '퇴직권유', '의원면직', '해고'],
  '사직':           ['사직', '의원면직', '퇴직', '사임'],
  '사직서':         ['사직서', '사직', '의원면직', '퇴직원'],
  '퇴직':           ['퇴직', '사직', '이직', '의원면직', '근로관계 종료'],
  '퇴직금':         ['퇴직금', '퇴직급여', '퇴직위로금', '퇴직금 중간정산'],
  '퇴직급여':       ['퇴직급여', '퇴직금', '퇴직연금', 'DC형', 'DB형', 'IRP'],
  '퇴직연금':       ['퇴직연금', '확정급여형', '확정기여형', 'DB형', 'DC형', 'IRP'],
  '중간정산':       ['중간정산', '퇴직금 중간정산', '중도인출'],
  '이직':           ['이직', '이직확인서', '근로관계 종료'],
  '명예퇴직':       ['명예퇴직', '명퇴', '희망퇴직', '조기퇴직'],
  '희망퇴직':       ['희망퇴직', '명예퇴직', '명퇴'],

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 2. 해고 / 징계
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  '해고':           ['해고', '해임', '파면', '면직', '정리해고', '징계해고'],
  '부당해고':       ['부당해고', '정당한 이유', '해고예고', '서면통지', '구제신청'],
  '정리해고':       ['정리해고', '경영상 이유에 의한 해고', '경영상의 이유', '긴박한 경영상의 필요'],
  '징계':           ['징계', '징계해고', '징계해임', '징계위원회', '견책', '감봉', '정직'],
  '징계해고':       ['징계해고', '징계', '징계위원회'],
  '해고예고':       ['해고예고', '해고예고수당', '30일 전'],
  '해고예고수당':   ['해고예고수당', '해고예고', '30일분의 통상임금'],
  '구제신청':       ['구제신청', '부당해고', '노동위원회', '구제명령'],
  '서면통지':       ['서면통지', '해고사유', '해고의 서면통지'],
  '경영상해고':     ['경영상 이유에 의한 해고', '정리해고', '긴박한 경영상의 필요'],

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 3. 휴가 / 휴직
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  '연차':           ['연차', '연차 유급휴가', '연차유급휴가', '유급휴가'],
  '연차휴가':       ['연차', '연차 유급휴가', '연차유급휴가', '유급휴가'],
  '연차수당':       ['연차수당', '연차 유급휴가 미사용수당', '연차 미사용'],
  '휴가':           ['휴가', '유급휴가', '연차', '병가', '경조사 휴가'],
  '병가':           ['병가', '질병', '요양', '치료'],
  '경조사':         ['경조사', '경조사 휴가', '경조 휴가'],
  '공가':           ['공가', '공민권 행사'],
  '생리휴가':       ['생리휴가', '보건휴가'],
  '출산휴가':       ['출산휴가', '출산전후휴가', '산전후휴가', '배우자 출산휴가'],
  '출산':           ['출산휴가', '출산전후휴가', '산전후휴가', '배우자 출산휴가', '임신', '난임'],
  '출산전후휴가':   ['출산전후휴가', '출산휴가', '산전후휴가', '90일'],
  '배우자출산휴가': ['배우자 출산휴가', '배우자출산휴가', '배우자의 출산'],
  '배우자 출산휴가':['배우자 출산휴가', '배우자출산휴가', '배우자의 출산'],
  '육아휴직':       ['육아휴직', '육아기 근로시간 단축', '육아휴가', '만 8세 이하'],
  '육아기근로시간단축': ['육아기 근로시간 단축', '육아기근로시간단축', '단축근무'],
  '난임':           ['난임치료휴가', '난임'],
  '난임치료휴가':   ['난임치료휴가', '난임', '난임치료'],
  '가족돌봄':       ['가족돌봄휴직', '가족돌봄휴가', '가족돌봄 등을 위한 근로시간 단축'],
  '가족돌봄휴직':   ['가족돌봄휴직', '가족돌봄', '가족 간호'],
  '돌봄휴가':       ['가족돌봄휴가', '돌봄휴가'],
  '임신':           ['임신', '임신부', '임산부', '태아검진'],
  '임산부':         ['임산부', '임신부', '임신', '산모'],
  '태아검진':       ['태아검진', '임산부 정기건강진단'],
  '수유':           ['수유', '수유 시간', '육아시간'],
  '예비군훈련':     ['예비군훈련', '예비군', '향토예비군'],

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 4. 임금 / 수당
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  '임금':           ['임금', '급여', '보수', '수당', '통상임금', '평균임금'],
  '급여':           ['급여', '임금', '보수', '봉급'],
  '최저임금':       ['최저임금', '최저시급', '최저시간급'],
  '통상임금':       ['통상임금', '정기상여금', '고정상여금'],
  '평균임금':       ['평균임금', '3개월', '직전 3개월'],
  '주휴':           ['주휴일', '주휴수당', '유급주휴일'],
  '주휴수당':       ['주휴수당', '주휴일', '유급'],
  '주휴일':         ['주휴일', '유급휴일', '주휴수당'],
  '노동절':         ['노동절', '근로자의 날', '근로자의날', '5월 1일'],
  '근로자의 날':    ['노동절', '근로자의 날', '근로자의날', '5월 1일'],
  '근로자의날':     ['노동절', '근로자의 날', '근로자의날', '5월 1일'],
  '상여금':         ['상여금', '보너스', '정기상여금', '명절상여'],
  '성과금':         ['성과금', '성과상여금', '인센티브'],
  '연장근로수당':   ['연장근로수당', '시간외수당', '오버타임수당', '연장근로'],
  '야간수당':       ['야간근로수당', '야간수당', '심야수당'],
  '휴일수당':       ['휴일근로수당', '휴일수당'],
  '가산수당':       ['가산수당', '가산임금', '50퍼센트', '연장근로'],
  '임금체불':       ['임금체불', '체불임금', '임금 미지급', '체불'],
  '체불':           ['체불', '임금체불', '체불임금', '임금 미지급'],
  '임금명세서':     ['임금명세서', '급여명세서', '임금대장'],
  '급여명세서':     ['급여명세서', '임금명세서', '임금대장'],
  '임금대장':       ['임금대장', '임금명세서'],
  '직접지급':       ['직접지급', '통화지급', '전액지급', '정기지급'],
  '전액지급':       ['전액지급', '임금 전액', '직접지급'],
  '비과세':         ['비과세', '실비변상', '식대'],
  '식대':           ['식대', '식비', '비과세'],
  '교통비':         ['교통비', '교통수당'],
  '복리후생':       ['복리후생', '복지'],
  '4대보험':        ['4대보험', '국민연금', '건강보험', '고용보험', '산재보험'],

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 5. 근로시간 / 휴일
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  '근로시간':       ['근로시간', '소정근로시간', '연장근로', '야간근로', '휴일근로'],
  '소정근로시간':   ['소정근로시간', '소정근로', '약정근로시간'],
  '법정근로시간':   ['법정근로시간', '주 40시간', '1일 8시간'],
  '연장근로':       ['연장근로', '시간외근로', '초과근로', '오버타임'],
  '시간외근로':     ['시간외근로', '연장근로', '초과근로'],
  '52시간':         ['주 52시간', '연장근로 한도', '주 12시간'],
  '야간':           ['야간근로', '야간', '심야', '오후 10시부터 다음날 오전 6시'],
  '야간근로':       ['야간근로', '야간', '심야근로'],
  '심야':           ['심야', '야간근로', '심야근로'],
  '휴일':           ['휴일', '주휴일', '공휴일', '대체휴일', '관공서의 공휴일'],
  '공휴일':         ['공휴일', '관공서의 공휴일', '법정공휴일'],
  '대체휴일':       ['대체휴일', '대체공휴일', '대체휴무'],
  '대체휴무':       ['대체휴무', '휴일대체', '근로일 대체'],
  '휴게시간':       ['휴게시간', '휴게', '점심시간'],
  '휴게':           ['휴게시간', '휴게', '4시간'],
  '교대제':         ['교대제', '교대근무', '교대근로', '2교대', '3교대'],
  '유연근무':       ['유연근무', '유연근무제', '선택적 근로시간제', '탄력적 근로시간제'],
  '탄력근무':       ['탄력적 근로시간제', '탄력근무', '탄력근로시간'],
  '선택근로':       ['선택적 근로시간제', '선택근로', '선택근무'],
  '재택근무':       ['재택근무', '원격근무', '재택'],
  '간주근로':       ['간주근로시간제', '간주근로', '재량근로'],
  '재량근로':       ['재량근로시간제', '재량근로', '간주근로'],

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 6. 차별 / 괴롭힘 / 성희롱
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  '직장내괴롭힘':   ['직장 내 괴롭힘', '직장내 괴롭힘', '직장내괴롭힘', '괴롭힘', '갑질'],
  '괴롭힘':         ['직장 내 괴롭힘', '괴롭힘', '갑질'],
  '갑질':           ['갑질', '직장 내 괴롭힘', '괴롭힘'],
  '성희롱':         ['직장 내 성희롱', '성희롱'],
  '성차별':         ['차별', '차별적 처우', '성차별', '남녀차별'],
  '차별':           ['차별', '차별적 처우', '평등', '균등처우'],
  '균등처우':       ['균등처우', '균등대우', '차별 금지'],
  '평등':           ['평등', '균등처우', '차별 금지'],
  '모성보호':       ['모성보호', '임산부', '임신', '출산'],
  '여성근로':       ['여성', '여성근로자', '임산부'],
  '연소근로':       ['연소근로자', '연소자', '미성년자', '15세', '18세 미만'],

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 7. 계약 / 채용
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  '근로계약':       ['근로계약', '근로계약서', '서면 근로계약'],
  '근로계약서':     ['근로계약서', '근로계약', '서면 명시', '서면 교부'],
  '계약직':         ['기간제', '계약직', '단시간', '비정규직'],
  '기간제':         ['기간제', '계약직', '2년', '갱신'],
  '단시간':         ['단시간근로자', '단시간', '시간제'],
  '시간제':         ['단시간', '시간제', '시간제근로자'],
  '비정규직':       ['비정규직', '기간제', '단시간', '파견'],
  '파견':           ['파견근로자', '파견근로', '파견사업', '파견사업주'],
  '파견근로자':     ['파견근로자', '파견근로'],
  '도급':           ['도급', '용역', '하도급'],
  '용역':           ['용역', '도급'],
  '특수형태':       ['특수형태근로종사자', '특고', '특수고용'],
  '수습':           ['수습', '시용', '수습기간'],
  '시용':           ['시용', '수습', '시용기간'],
  '시용기간':       ['시용', '시용기간', '본채용 거부'],
  '채용':           ['채용', '모집', '채용공고'],
  '입사':           ['입사', '채용', '근로 개시'],
  '신원보증':       ['신원보증', '신원보증인'],

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 8. 산재 / 안전 / 건강
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  '산재':           ['산업재해', '산재', '재해', '업무상 재해'],
  '산업재해':       ['산업재해', '산재', '업무상 재해', '업무상 질병'],
  '업무상재해':     ['업무상 재해', '업무상재해', '산업재해'],
  '업무상질병':     ['업무상 질병', '업무상질병', '직업병'],
  '직업병':         ['직업병', '업무상 질병', '직업성 질환'],
  '요양급여':       ['요양급여', '치료비', '산재 요양'],
  '휴업급여':       ['휴업급여', '산재 휴업', '70퍼센트'],
  '장해급여':       ['장해급여', '장해', '신체장해'],
  '유족급여':       ['유족급여', '유족', '사망'],
  '안전':           ['안전', '안전관리', '안전보건', '안전교육'],
  '안전보건':       ['안전보건', '안전보건교육', '안전관리'],
  '안전교육':       ['안전교육', '안전보건교육', '근로자 교육'],
  '건강검진':       ['건강검진', '건강진단', '일반건강진단', '특수건강진단'],
  '건강진단':       ['건강진단', '건강검진'],
  '중대재해':       ['중대재해', '중대산업재해', '사망사고'],
  '위험성평가':     ['위험성평가', '안전점검'],

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 9. 고용보험 / 실업급여
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  '실업급여':       ['실업급여', '구직급여', '실업 인정'],
  '구직급여':       ['구직급여', '실업급여'],
  '고용보험':       ['고용보험', '실업급여', '고용유지지원금'],
  '실업':           ['실업', '실업급여', '구직'],
  '이직확인서':     ['이직확인서', '이직사유', '실업급여'],
  '고용유지':       ['고용유지지원금', '고용유지'],
  '취업촉진수당':   ['취업촉진수당', '조기재취업수당'],
  '직업훈련':       ['직업훈련', '직업능력개발', '내일배움카드'],

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 10. 노조 / 단체교섭
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  '노조':           ['노동조합', '노조', '근로자단체'],
  '노동조합':       ['노동조합', '노조'],
  '단체교섭':       ['단체교섭', '단체협약', '교섭'],
  '단체협약':       ['단체협약', '단협', '단체교섭'],
  '쟁의':           ['쟁의행위', '쟁의', '파업', '직장폐쇄'],
  '파업':           ['파업', '쟁의행위', '쟁의'],
  '직장폐쇄':       ['직장폐쇄', '쟁의'],
  '부당노동행위':   ['부당노동행위', '노조 차별', '단결권 침해'],
  '노사협의회':     ['노사협의회', '근로자참여', '협의'],
  '근로자대표':     ['근로자대표', '근로자 과반수 대표'],

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 11. 취업규칙 / 기타
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  '취업규칙':       ['취업규칙', '사규', '인사규정'],
  '사규':           ['사규', '취업규칙'],
  '인사이동':       ['인사이동', '전직', '전보', '배치전환'],
  '전직':           ['전직', '전보', '인사이동'],
  '전보':           ['전보', '전직', '배치전환'],
  '직위해제':       ['직위해제', '대기발령'],
  '대기발령':       ['대기발령', '직위해제'],
  '강등':           ['강등', '직급 강등', '징계'],
  '감봉':           ['감봉', '임금 감액', '징계'],
  '정직':           ['정직', '근로 정지', '징계'],
  '견책':           ['견책', '경고', '징계'],
  '시말서':         ['시말서', '경위서', '확인서'],
  '근로감독':       ['근로감독관', '근로감독', '점검'],
  '진정':           ['진정', '신고', '고용노동부 진정'],
  '신고':           ['신고', '진정', '고발'],
  '노동위원회':     ['노동위원회', '지방노동위원회', '중앙노동위원회'],
  '구제명령':       ['구제명령', '부당해고 구제', '노동위원회'],
  '재심':           ['재심', '재심신청', '중앙노동위원회'],

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 12. 기타 자주 쓰는 키워드
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  '복직':           ['복직', '원직복직', '부당해고 구제'],
  '원직복직':       ['원직복직', '복직'],
  '재택':           ['재택근무', '원격근무'],
  '원격':           ['원격근무', '재택근무'],
  '겸업':           ['겸업', '겸직', '겸직금지'],
  '겸직':           ['겸직', '겸업'],
  '비밀유지':       ['비밀유지', '영업비밀', '경업금지'],
  '경업금지':       ['경업금지', '동종업계'],
  '교육훈련':       ['교육훈련', '직무교육', '연수'],
  '연수':           ['연수', '교육훈련'],
  '포상':           ['포상', '표창', '시상'],
  '근속':           ['근속', '근속기간', '계속근로'],
  '계속근로':       ['계속근로', '근속', '근속기간'],
  '입사일':         ['입사일', '근로 개시일'],
  '퇴직일':         ['퇴직일', '근로 종료일'],

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 13. 추가 자주 쓰는 키워드
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  '근태':           ['근태', '출근', '결근', '지각', '조퇴'],
  '결근':           ['결근', '무단결근', '무단이탈'],
  '지각':           ['지각', '근태'],
  '조퇴':           ['조퇴', '근태'],
  '무단결근':       ['무단결근', '무단이탈', '결근'],
  '연봉':           ['연봉', '연봉제', '연봉계약'],
  '연봉제':         ['연봉제', '연봉'],
  '포괄임금':       ['포괄임금', '포괄임금제', '포괄산정임금'],
  '포괄임금제':     ['포괄임금제', '포괄임금', '포괄산정'],
  '복리후생비':     ['복리후생비', '복리후생'],
  '경력증명서':     ['경력증명서', '재직증명서', '근로 사실증명'],
  '재직증명서':     ['재직증명서', '경력증명서', '근로증명서'],
  '근로증명서':     ['근로증명서', '재직증명서'],
  '취업방해':       ['취업방해', '취업 방해', '재취업 방해'],
  '강제근로':       ['강제근로', '강제노동'],
  '중간착취':       ['중간착취', '중간개입', '중간이익'],
  '폭행':           ['폭행', '근로자 폭행', '폭행 금지'],
  '위약금':         ['위약금', '손해배상 예정'],
  '손해배상':       ['손해배상', '배상 예정'],
  '근로조건':       ['근로조건', '근로조건 명시'],
  '취업':           ['취업', '취업제한', '취업방해'],
  '미성년자':       ['미성년자', '연소자', '18세 미만', '15세'],
  '아동':           ['아동', '15세 미만', '취직인허'],
  '인허':           ['취직인허증', '취직인허'],
  '안전모':         ['안전모', '보호구', '개인보호장비'],
  '보호구':         ['보호구', '안전장비', '개인보호장비'],
  '작업환경':       ['작업환경', '작업환경측정', '유해인자'],
  '유해':           ['유해인자', '유해물질', '작업환경'],
  '특수건강진단':   ['특수건강진단', '유해인자', '건강진단'],
  '재해예방':       ['재해예방', '안전보건교육', '위험성평가'],
  '도급사업':       ['도급사업', '도급인', '수급인'],
  '체당금':         ['체당금', '체불임금', '간이대지급금'],
  '간이대지급금':   ['간이대지급금', '체당금', '체불임금'],
  '확정급여':       ['확정급여형', 'DB형', '퇴직연금'],
  '확정기여':       ['확정기여형', 'DC형', '퇴직연금'],
};

// ─────────────────────────────────────────────────────────
// 키워드 -> 검색할 동의어 목록 생성
// 사전에 없으면 원본 키워드만 반환 (안전망)
// ─────────────────────────────────────────────────────────
function expandKeywords(query) {
  const normalized = query.replace(/\s+/g, '');
  // 사전에서 매칭되는 항목 찾기 (공백 제거 후 비교)
  for (const [key, syns] of Object.entries(SYNONYMS)) {
    if (key.replace(/\s+/g, '') === normalized) {
      return syns;
    }
  }
  return [query]; // 사전에 없으면 입력 그대로
}

// ─────────────────────────────────────────────────────────
// 조문이 키워드 목록 중 하나라도 포함하는지 검사
// ─────────────────────────────────────────────────────────
function articleMatchesAny(unit, keywords) {
  const text = JSON.stringify(unit);
  const normalizedText = text.replace(/\s+/g, '');
  return keywords.some(kw => {
    const kwNorm = kw.replace(/\s+/g, '');
    return text.includes(kw) || normalizedText.includes(kwNorm);
  });
}

// ─────────────────────────────────────────────────────────
// 법령 조문 가져오기
// ─────────────────────────────────────────────────────────
async function fetchArticles(mst, keywords) {
  try {
    const resp = await axios.get(`${BASE}/lawService.do`, {
      params: { OC: API_KEY, target: 'law', type: 'JSON', MST: mst },
      timeout: 10000,
    });
    const units = resp.data?.법령?.조문?.조문단위 || [];
    const filtered = units.filter(u => articleMatchesAny(u, keywords));

    return filtered.map(a => {
      const hangList = a.항 ? (Array.isArray(a.항) ? a.항 : [a.항]) : [];
      return {
        조문번호: a.조문번호 || '',
        조문제목: a.조문제목 || '',
        조문내용: a.조문내용 || '',
        항: hangList.map(h => {
          const hoList = h.호 ? (Array.isArray(h.호) ? h.호 : [h.호]) : [];
          return {
            항번호: h.항번호 || '',
            항내용: h.항내용 || '',
            호: hoList.map(ho => ({ 호번호: ho.호번호 || '', 호내용: ho.호내용 || '' })),
          };
        }),
      };
    });
  } catch (err) {
    console.error(`조문 가져오기 실패 (MST: ${mst}):`, err.message);
    return [];
  }
}

// ─────────────────────────────────────────────────────────
// 판례 검색 (페이지네이션 지원)
// ─────────────────────────────────────────────────────────
async function searchPrecedents(keywords, page = 1, display = 20) {
  try {
    // 동의어 상위 5개로 병렬 검색 (호출 폭주 방지)
    const searchTerms = keywords.slice(0, 5);

    const results = await Promise.allSettled(
      searchTerms.map(kw =>
        axios.get(`${BASE}/lawSearch.do`, {
          params: {
            OC: API_KEY, target: 'prec', type: 'JSON',
            query: kw, display, page,
            sort: 'date',
          },
          timeout: 15000,
        })
      )
    );

    // 각 검색 결과를 합치고 중복 제거
    const seenIds = new Set();
    let allItems = [];
    let maxTotal = 0;

    results.forEach(r => {
      if (r.status !== 'fulfilled') return;
      const list = r.value.data?.PrecSearch?.prec || [];
      const totalCnt = parseInt(r.value.data?.PrecSearch?.totalCnt || '0', 10);
      if (totalCnt > maxTotal) maxTotal = totalCnt;

      (Array.isArray(list) ? list : [list]).forEach(p => {
        const id = p.판례일련번호 || '';
        if (id && seenIds.has(id)) return;
        if (id) seenIds.add(id);
        allItems.push({
          사건명: p.사건명 || '',
          사건번호: p.사건번호 || '',
          선고일자: p.선고일자 || '',
          법원명: p.법원명 || '',
          판시사항: p.판시사항 || '',
          판례일련번호: id,
          링크: id ? `https://www.law.go.kr/LSW/precInfoP.do?precSeq=${id}` : '',
          검색링크: p.사건번호
            ? `https://www.law.go.kr/판례검색?query=${encodeURIComponent(p.사건번호)}`
            : `https://www.law.go.kr/판례검색?query=${encodeURIComponent(p.사건명 || '')}`,
        });
      });
    });

    // 선고일자 내림차순 (최신순) 정렬
    allItems.sort((a, b) => (b.선고일자 || '').localeCompare(a.선고일자 || ''));

    // 페이지당 display 건수로 자르기
    const startIdx = (page - 1) * display;
    const pagedItems = allItems.slice(startIdx, startIdx + display);

    return {
      items: pagedItems,
      totalCnt: Math.max(allItems.length, maxTotal),
      page,
      display,
    };
  } catch (err) {
    console.error('판례 검색 실패:', err.message);
    return { items: [], totalCnt: 0, page, display };
  }
}

// ─────────────────────────────────────────────────────────
// 행정해석 검색 (고용노동부 등 행정기관의 법령 해석)
// target='expc' : 법령해석례
// ─────────────────────────────────────────────────────────
async function searchExpcs(keywords, page = 1, display = 10) {
  try {
    const searchTerms = keywords.slice(0, 5);

    const results = await Promise.allSettled(
      searchTerms.map(kw =>
        axios.get(`${BASE}/lawSearch.do`, {
          params: {
            OC: API_KEY, target: 'expc', type: 'JSON',
            query: kw, display, page,
            sort: 'date',
          },
          timeout: 15000,
        })
      )
    );

    const seenIds = new Set();
    let allItems = [];
    let maxTotal = 0;

    results.forEach(r => {
      if (r.status !== 'fulfilled') return;
      const list = r.value.data?.Expc?.expc || [];
      const totalCnt = parseInt(r.value.data?.Expc?.totalCnt || '0', 10);
      if (totalCnt > maxTotal) maxTotal = totalCnt;

      (Array.isArray(list) ? list : [list]).forEach(e => {
        const id = e.법령해석례일련번호 || e.해석례일련번호 || '';
        if (id && seenIds.has(id)) return;
        if (id) seenIds.add(id);
        allItems.push({
          안건명: e.안건명 || '',
          안건번호: e.안건번호 || '',
          회신일자: e.회신일자 || e.해석일자 || '',
          해석기관: e.해석기관명 || e.회신기관명 || '고용노동부',
          질의요지: (e.질의요지 || '').slice(0, 250),
          회답: (e.회답 || '').slice(0, 300),
          해석례일련번호: id,
          링크: id ? `https://www.law.go.kr/LSW/expcInfoP.do?expcSeq=${id}` : '',
        });
      });
    });

    allItems.sort((a, b) => (b.회신일자 || '').localeCompare(a.회신일자 || ''));

    const startIdx = (page - 1) * display;
    const pagedItems = allItems.slice(startIdx, startIdx + display);

    return {
      items: pagedItems,
      totalCnt: Math.max(allItems.length, maxTotal),
      page,
      display,
    };
  } catch (err) {
    console.error('행정해석 검색 실패:', err.message);
    return { items: [], totalCnt: 0, page, display };
  }
}

// 행정해석 더보기 전용 API
app.get('/api/expcs', async (req, res) => {
  const { query, page } = req.query;
  if (!query) return res.status(400).json({ error: '검색어를 입력해주세요.' });
  try {
    const keywords = expandKeywords(query);
    const result = await searchExpcs(keywords, parseInt(page || '1', 10), 10);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: '행정해석 검색 오류' });
  }
});

// 판례 더보기 전용 API
app.get('/api/precedents', async (req, res) => {
  const { query, page } = req.query;
  if (!query) return res.status(400).json({ error: '검색어를 입력해주세요.' });
  try {
    const keywords = expandKeywords(query);
    const result = await searchPrecedents(keywords, parseInt(page || '1', 10), 20);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: '판례 검색 오류' });
  }
});

// ─────────────────────────────────────────────────────────
// 메인 검색 API (전체 법령 대상)
//
// 전략:
// 1. 동의어 확장 (사전 등록된 경우)
// 2. 법령명 검색 + 본문 키워드 검색 (search=2) 양쪽으로 후보 확보
// 3. 상위 관련 법령 최대 10개의 조문을 병렬 조회
// 4. 판례도 함께 검색
// ─────────────────────────────────────────────────────────
const MAX_LAWS_TO_FETCH = 10; // 한 번에 조문 조회할 법령 최대 수

app.get('/api/search', async (req, res) => {
  const { query } = req.query;
  if (!query) return res.status(400).json({ error: '검색어를 입력해주세요.' });

  try {
    // 1) 동의어 확장 (없으면 원본만)
    const keywords = expandKeywords(query);
    console.log(`[검색] "${query}" -> 동의어:`, keywords);

    let candidateLaws = [];
    const seenMsts = new Set();

    // 2) 법령명 검색 (search=1: 법령명 검색이 기본값)
    try {
      const nameResp = await axios.get(`${BASE}/lawSearch.do`, {
        params: { OC: API_KEY, target: 'law', type: 'JSON', query, display: 50, search: 1 },
        timeout: 15000,
      });
      const found = nameResp.data?.LawSearch?.law || [];
      found.forEach(l => {
        if (!seenMsts.has(l.법령일련번호)) {
          seenMsts.add(l.법령일련번호);
          candidateLaws.push({
            mst: l.법령일련번호,
            name: l.법령명한글 || l.법령명,
            type: l.법령구분명 || '',
            소관부처: l.소관부처명 || '법제처',
            시행일자: l.시행일자 || '',
            공포일자: l.공포일자 || '',
            source: '법령명검색',
          });
        }
      });
      console.log(`[검색] 법령명 검색 결과: ${found.length}건`);
    } catch (e) {
      console.error('법령명 검색 실패:', e.message);
    }

    // 3) 본문 검색 (search=2: 조문 본문에서 키워드 찾기)
    try {
      const bodyResp = await axios.get(`${BASE}/lawSearch.do`, {
        params: { OC: API_KEY, target: 'law', type: 'JSON', query, display: 50, search: 2 },
        timeout: 15000,
      });
      const found = bodyResp.data?.LawSearch?.law || [];
      found.forEach(l => {
        if (!seenMsts.has(l.법령일련번호)) {
          seenMsts.add(l.법령일련번호);
          candidateLaws.push({
            mst: l.법령일련번호,
            name: l.법령명한글 || l.법령명,
            type: l.법령구분명 || '',
            소관부처: l.소관부처명 || '법제처',
            시행일자: l.시행일자 || '',
            공포일자: l.공포일자 || '',
            source: '본문검색',
          });
        }
      });
      console.log(`[검색] 본문 검색 결과: ${found.length}건`);
    } catch (e) {
      console.error('본문 검색 실패:', e.message);
    }

    // 4) 동의어들로도 본문 검색 (사전에 등록된 경우만)
    if (keywords.length > 1) {
      const extraKeywords = keywords.filter(k => k !== query).slice(0, 3);
      for (const kw of extraKeywords) {
        try {
          const resp = await axios.get(`${BASE}/lawSearch.do`, {
            params: { OC: API_KEY, target: 'law', type: 'JSON', query: kw, display: 20, search: 2 },
            timeout: 10000,
          });
          const found = resp.data?.LawSearch?.law || [];
          found.forEach(l => {
            if (!seenMsts.has(l.법령일련번호)) {
              seenMsts.add(l.법령일련번호);
              candidateLaws.push({
                mst: l.법령일련번호,
                name: l.법령명한글 || l.법령명,
                type: l.법령구분명 || '',
                소관부처: l.소관부처명 || '법제처',
                시행일자: l.시행일자 || '',
                공포일자: l.공포일자 || '',
                source: `동의어(${kw})`,
              });
            }
          });
        } catch (e) {
          console.error(`동의어 검색 실패 (${kw}):`, e.message);
        }
      }
    }

    console.log(`[검색] 총 후보 법령: ${candidateLaws.length}건`);

    // 5) 공인노무사 시험 범위 + 고용노동부 소관 법령 통과
    const filteredLaws = candidateLaws.filter(l => isAllowedLaw(l.name, l.소관부처));
    console.log(`[검색] 화이트리스트 통과: ${filteredLaws.length}건`);

    // 6) 결과 안내
    if (filteredLaws.length === 0 && candidateLaws.length > 0) {
      console.log('[검색] 노무사/고용노동부 범위 외 키워드');
    }

    // 7) 카테고리 우선순위 정렬
    const categoryOrder = {
      '노동법(1)': 1,
      '노동법(2)': 2,
      '사회보험법': 3,
      '기타 노동법령': 4,
      '민법': 5,
    };
    filteredLaws.sort((a, b) => {
      const catA = getCategoryFor(a.name, a.소관부처);
      const catB = getCategoryFor(b.name, b.소관부처);
      return (categoryOrder[catA] || 99) - (categoryOrder[catB] || 99);
    });

    // 8) 상위 N개만 조문 상세 조회 (성능 보호)
    const lawsToFetch = filteredLaws.slice(0, MAX_LAWS_TO_FETCH);

    const lawResults = await Promise.allSettled(
      lawsToFetch.map(async law => {
        const articles = await fetchArticles(law.mst, keywords);
        return {
          법령명: law.name,
          법령구분: law.type || '',
          소관부처: law.소관부처 || '',
          시행일자: law.시행일자 || '',
          공포일자: law.공포일자 || '',
          법령일련번호: law.mst,
          카테고리: getCategoryFor(law.name, law.소관부처),
          articles,
        };
      })
    );

    // 9) 조문 있는 법령 우선, 조문 많은 순으로 정렬
    const allLaws = lawResults.filter(r => r.status === 'fulfilled').map(r => r.value);
    const withArticles = allLaws
      .filter(l => l.articles.length > 0)
      .sort((a, b) => {
        // 카테고리 우선, 그 다음 조문 수
        const catDiff = (categoryOrder[a.카테고리] || 99) - (categoryOrder[b.카테고리] || 99);
        if (catDiff !== 0) return catDiff;
        return b.articles.length - a.articles.length;
      });

    // 조문이 없어도 법령명으로 매칭된 법령은 일부 보여주기
    const withoutArticles = allLaws
      .filter(l => l.articles.length === 0)
      .slice(0, 5);

    const finalLaws = [...withArticles, ...withoutArticles].slice(0, MAX_LAWS_TO_FETCH);

    // 10) 판례 검색 (첫 페이지, 20건)
    const precResult = await searchPrecedents(keywords, 1, 20);

    // 11) 행정해석 검색 (첫 페이지, 10건)
    const expcResult = await searchExpcs(keywords, 1, 10);

    res.json({
      keyword: query,
      expandedKeywords: keywords,
      totalCandidates: filteredLaws.length,
      results: finalLaws,
      precedents: precResult.items,
      precedentsTotal: precResult.totalCnt,
      precedentsPage: precResult.page,
      expcs: expcResult.items,
      expcsTotal: expcResult.totalCnt,
      expcsPage: expcResult.page,
      stats: {
        법령수: withArticles.length,
        조문수: withArticles.reduce((s, l) => s + l.articles.length, 0),
        판례수: precResult.totalCnt,
        행정해석수: expcResult.totalCnt,
      },
    });
  } catch (err) {
    console.error('검색 오류:', err.message);
    res.status(500).json({ error: '검색 중 오류가 발생했습니다.' });
  }
});

// ─────────────────────────────────────────────────────────
// 최신 개정 법령 (공인노무사 시험 범위 한정)
// ─────────────────────────────────────────────────────────
app.get('/api/recent', async (req, res) => {
  const { category } = req.query;
  try {
    // 노무사 시험 범위 법령들을 카테고리별로 모두 검색
    const targetLaws = category
      ? ALLOWED_LAWS.filter(l => l.category === category)
      : ALLOWED_LAWS;

    const allResults = [];
    const seen = new Set();

    // 1) 각 법령명으로 검색
    for (const allowed of targetLaws) {
      try {
        const resp = await axios.get(`${BASE}/lawSearch.do`, {
          params: {
            OC: API_KEY, target: 'law', type: 'JSON',
            query: allowed.name, display: 5, sort: 'date',
          },
          timeout: 10000,
        });
        const found = resp.data?.LawSearch?.law || [];
        found.forEach(l => {
          const name = l.법령명한글 || l.법령명;
          const dept = l.소관부처명 || '';
          if (isAllowedLaw(name, dept) && !seen.has(l.법령일련번호)) {
            seen.add(l.법령일련번호);
            l._category = getCategoryFor(name, dept);
            allResults.push(l);
          }
        });
      } catch (e) {
        console.error(`최신 개정 검색 실패 (${allowed.name}):`, e.message);
      }
    }

    // 2) 추가: 고용노동부 소관 법령 전체 끌어오기 (카테고리 미지정 또는 '기타 노동법령'일 때)
    if (!category || category === '기타 노동법령') {
      // '근로자의 날', '노동절' 등 핵심 키워드로 추가 검색
      const extraKeywords = ['근로자의 날', '노동절', '근로자의날'];
      for (const kw of extraKeywords) {
        try {
          const resp = await axios.get(`${BASE}/lawSearch.do`, {
            params: {
              OC: API_KEY, target: 'law', type: 'JSON',
              query: kw, display: 5, sort: 'date',
            },
            timeout: 10000,
          });
          const found = resp.data?.LawSearch?.law || [];
          found.forEach(l => {
            const name = l.법령명한글 || l.법령명;
            const dept = l.소관부처명 || '';
            if (isAllowedLaw(name, dept) && !seen.has(l.법령일련번호)) {
              seen.add(l.법령일련번호);
              l._category = getCategoryFor(name, dept);
              allResults.push(l);
            }
          });
        } catch (e) {
          console.error(`추가 키워드 검색 실패 (${kw}):`, e.message);
        }
      }

      // 고용노동부 소관 법령을 광범위하게 끌어오기
      try {
        const resp = await axios.get(`${BASE}/lawSearch.do`, {
          params: {
            OC: API_KEY, target: 'law', type: 'JSON',
            org: '1492000', // 고용노동부 부처코드
            display: 30, sort: 'date',
          },
          timeout: 15000,
        });
        const found = resp.data?.LawSearch?.law || [];
        found.forEach(l => {
          const name = l.법령명한글 || l.법령명;
          const dept = l.소관부처명 || '고용노동부';
          if (isAllowedLaw(name, dept) && !seen.has(l.법령일련번호)) {
            seen.add(l.법령일련번호);
            l._category = getCategoryFor(name, dept);
            allResults.push(l);
          }
        });
      } catch (e) {
        console.error('고용노동부 소관 검색 실패:', e.message);
      }
    }

    // 공포일자 내림차순 정렬
    allResults.sort((a, b) => (b.공포일자 || '').localeCompare(a.공포일자 || ''));

    res.json({
      LawSearch: {
        law: allResults.slice(0, 50),
        totalCnt: allResults.length,
      },
    });
  } catch (err) {
    console.error('최신 법령 오류:', err.message);
    res.status(500).json({ error: '최신 법령 조회 오류' });
  }
});

// ─────────────────────────────────────────────────────────
// 법령 개정 상세 조회 (개정문, 제·개정이유)
// MST를 받아서 어떤 부분이 개정됐는지 반환
// ─────────────────────────────────────────────────────────
app.get('/api/law-detail/:mst', async (req, res) => {
  const { mst } = req.params;
  if (!mst) return res.status(400).json({ error: 'MST 필요' });

  try {
    const resp = await axios.get(`${BASE}/lawService.do`, {
      params: { OC: API_KEY, target: 'law', type: 'JSON', MST: mst },
      timeout: 15000,
    });

    const law = resp.data?.법령 || {};
    const basicInfo = law.기본정보 || {};
    const reasons = law.제개정이유 || law.개정이유 || '';
    const revisedText = law.개정문 || '';

    // 부칙도 함께 (개정 시점의 시행일/적용 규정)
    const addendum = law.부칙 || {};

    // 법령명 검증 (안전을 위해)
    const lawName = basicInfo.법령명_한글 || basicInfo.법령명 || '';
    const lawNameClean = (typeof lawName === 'string') ? lawName : (lawName?._text || '');

    res.json({
      mst,
      법령명: lawNameClean,
      공포일자: basicInfo.공포일자 || '',
      시행일자: basicInfo.시행일자 || '',
      제개정구분: basicInfo.제개정구분 || basicInfo['제·개정구분'] || '',
      소관부처: basicInfo.소관부처 || '',
      개정이유: typeof reasons === 'string' ? reasons : (reasons?._text || JSON.stringify(reasons)),
      개정문: typeof revisedText === 'string' ? revisedText : (revisedText?._text || ''),
      부칙: addendum,
      // 법제처 상세 페이지 링크
      상세링크: `https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=${mst}&efYd=&ancYnChk=0`,
      // 신구조문대비표 링크
      대비표링크: `https://www.law.go.kr/LSW/lsRvsDocListP.do?lsId=${mst}`,
    });
  } catch (err) {
    console.error('법령 상세 오류:', err.message);
    res.status(500).json({ error: '법령 상세 조회 실패' });
  }
});

// ─────────────────────────────────────────────────────────
// 팀원 관리
// ─────────────────────────────────────────────────────────
app.get('/api/members', (req, res) => {
  res.json(dataStore.members.map(m => ({
    name: m.name,
    email: m.email,
    active: m.active,
    role: m.role || 'member',
    personalKeywords: m.personalKeywords || [],
  })));
});

app.post('/api/members', (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) return res.status(400).json({ error: '이름과 이메일을 입력해주세요.' });
  if (dataStore.members.some(m => m.email === email)) {
    return res.status(400).json({ error: '이미 등록된 이메일입니다.' });
  }
  dataStore.members.push({ name, email, active: true, role: 'member', personalKeywords: [] });
  members = dataStore.members;
  saveData();
  res.json({ success: true });
});

app.patch('/api/members/:email', (req, res) => {
  const m = dataStore.members.find(m => m.email === req.params.email);
  if (!m) return res.status(404).json({ error: '팀원 없음' });
  if (req.body.active !== undefined) m.active = req.body.active;
  if (req.body.personalKeywords !== undefined) m.personalKeywords = req.body.personalKeywords;
  saveData();
  res.json({ success: true });
});

app.delete('/api/members/:email', (req, res) => {
  const idx = dataStore.members.findIndex(m => m.email === req.params.email);
  if (idx === -1) return res.status(404).json({ error: '팀원 없음' });
  dataStore.members.splice(idx, 1);
  members = dataStore.members;
  saveData();
  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────
// 공통 키워드 관리 (관리자가 설정, 모든 팀원에게 알림)
// ─────────────────────────────────────────────────────────
app.get('/api/keywords', (req, res) => {
  res.json({ commonKeywords: dataStore.commonKeywords });
});

app.post('/api/keywords', (req, res) => {
  const { keyword } = req.body;
  if (!keyword || !keyword.trim()) return res.status(400).json({ error: '키워드를 입력해주세요.' });
  const kw = keyword.trim();
  if (dataStore.commonKeywords.includes(kw)) {
    return res.status(400).json({ error: '이미 등록된 키워드입니다.' });
  }
  dataStore.commonKeywords.push(kw);
  saveData();
  res.json({ success: true, commonKeywords: dataStore.commonKeywords });
});

app.delete('/api/keywords/:keyword', (req, res) => {
  const kw = decodeURIComponent(req.params.keyword);
  const idx = dataStore.commonKeywords.indexOf(kw);
  if (idx === -1) return res.status(404).json({ error: '키워드 없음' });
  dataStore.commonKeywords.splice(idx, 1);
  saveData();
  res.json({ success: true });
});

// ─────────────────────────────────────────────────────────
// 알림 내역 조회
// ─────────────────────────────────────────────────────────
app.get('/api/alerts', (req, res) => {
  // 최신순 정렬, 최근 50건만
  const sorted = [...dataStore.alertHistory].sort((a, b) => b.createdAt - a.createdAt).slice(0, 50);
  res.json({ alerts: sorted });
});

// 수동 알림 체크 트리거 (테스트용)
app.post('/api/alerts/check', async (req, res) => {
  try {
    const result = await runKeywordAlertCheck();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────
// 이메일 알림 - 키워드 기반
// ─────────────────────────────────────────────────────────
async function sendKeywordAlertEmail(member, matches) {
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log('[알림] SMTP 미설정으로 이메일 발송 생략');
    return false;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });

  // HTML 이메일 본문 생성
  let html = `
    <div style="font-family: 'Malgun Gothic', sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: #0f2044; color: white; padding: 20px; border-radius: 8px 8px 0 0;">
        <h2 style="margin: 0; font-size: 18px;">⚖ 법령 인사이트</h2>
        <p style="margin: 5px 0 0; font-size: 13px; color: #f0d090;">${member.name}님, 관심 키워드 관련 새 소식이 있습니다.</p>
      </div>
      <div style="background: white; border: 1px solid #ddd; border-top: none; padding: 20px; border-radius: 0 0 8px 8px;">
  `;

  matches.forEach(m => {
    html += `
      <div style="margin-bottom: 20px; padding-bottom: 15px; border-bottom: 1px solid #eee;">
        <div style="background: #fdf5e4; color: #8a6310; display: inline-block; padding: 3px 10px; border-radius: 99px; font-size: 12px; font-weight: 500;">
          #${m.keyword}
        </div>
        <h3 style="font-size: 15px; margin: 8px 0 5px; color: #0f2044;">${m.title}</h3>
        <p style="font-size: 13px; color: #666; margin: 0 0 5px;">${m.type === 'law' ? '📜 법령' : '⚖ 판례'} · ${m.date}</p>
        <p style="font-size: 13px; color: #333; line-height: 1.6; margin: 0;">${m.snippet}</p>
      </div>
    `;
  });

  html += `
        <p style="font-size: 12px; color: #888; margin-top: 15px;">자세한 내용은 <a href="http://localhost:3000" style="color: #1a5296;">서비스에 접속</a>하여 확인하세요.</p>
      </div>
    </div>
  `;

  try {
    await transporter.sendMail({
      from: `"법령 인사이트" <${process.env.SMTP_USER}>`,
      to: member.email,
      subject: `[알림] 관심 키워드 ${matches.length}건 - ${matches.map(m => m.keyword).slice(0,3).join(', ')} 등`,
      html,
    });
    console.log(`[알림] ${member.email}에게 ${matches.length}건 이메일 발송 완료`);
    return true;
  } catch (err) {
    console.error(`[알림] 메일 발송 실패 (${member.email}):`, err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────
// 키워드 알림 체크 - 매일 오전 8시 실행
//
// 1. 최근 7일 이내 개정 법령에서 키워드 매칭 확인
// 2. 최근 등록 판례에서 키워드 매칭 확인
// 3. 매칭된 항목을 팀원별로 이메일 발송 + 화면에 저장
// ─────────────────────────────────────────────────────────
async function runKeywordAlertCheck() {
  console.log('\n[알림체크] 시작:', new Date().toISOString());

  // 7일 전 날짜 계산
  const today = new Date();
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fromDate = sevenDaysAgo.toISOString().slice(0,10).replace(/-/g,'');
  const todayStr = today.toISOString().slice(0,10).replace(/-/g,'');

  const newAlerts = [];

  // 1) 모든 키워드 수집 (공통 + 팀원 개인)
  const allKeywords = new Set(dataStore.commonKeywords);
  dataStore.members.forEach(m => {
    if (m.active && m.personalKeywords) {
      m.personalKeywords.forEach(kw => allKeywords.add(kw));
    }
  });

  console.log(`[알림체크] 검사할 키워드: ${[...allKeywords].join(', ')}`);

  // 2) 각 키워드로 최근 개정 법령 검색 (공인노무사 시험 범위만)
  let recentLaws = [];
  const seenMsts = new Set();
  for (const keyword of allKeywords) {
    try {
      const resp = await axios.get(`${BASE}/lawSearch.do`, {
        params: { OC: API_KEY, target: 'law', type: 'JSON', query: keyword, sort: 'date', display: 20 },
        timeout: 10000,
      });
      const found = resp.data?.LawSearch?.law || [];
      found.forEach(l => {
        const lawName = l.법령명한글 || l.법령명;
        const dept = l.소관부처명 || '';
        // 노무사 범위 + 고용노동부 소관 법령 + 최근 7일 이내
        if (!seenMsts.has(l.법령일련번호)
            && l.공포일자 >= fromDate
            && l.공포일자 <= todayStr
            && isAllowedLaw(lawName, dept)) {
          seenMsts.add(l.법령일련번호);
          l._matchedKeyword = keyword;
          recentLaws.push(l);
        }
      });
    } catch (err) {
      console.error(`[알림체크] 법령 검색 실패 (${keyword}):`, err.message);
    }
  }
  console.log(`[알림체크] 최근 7일 개정 법령 (노무사 범위): ${recentLaws.length}건`);

  // 3) 각 키워드로 최근 판례 검색
  for (const keyword of allKeywords) {
    try {
      const resp = await axios.get(`${BASE}/lawSearch.do`, {
        params: { OC: API_KEY, target: 'prec', type: 'JSON', query: keyword, display: 5, sort: 'date' },
        timeout: 10000,
      });
      const precs = resp.data?.PrecSearch?.prec || [];
      const list = Array.isArray(precs) ? precs : [precs];

      // 최근 30일 이내 판례만
      const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)
        .toISOString().slice(0,10).replace(/-/g,'');

      list.forEach(p => {
        if (p.선고일자 && p.선고일자 >= thirtyDaysAgo) {
          newAlerts.push({
            id: `prec-${p.판례일련번호}-${keyword}`,
            type: 'prec',
            keyword,
            title: p.사건명 || '판례',
            date: p.선고일자,
            court: p.법원명 || '대법원',
            caseNo: p.사건번호 || '',
            snippet: (p.판시사항 || '관련 판례').slice(0, 200),
            createdAt: Date.now(),
          });
        }
      });
    } catch (err) {
      console.error(`[알림체크] 판례 검색 실패 (${keyword}):`, err.message);
    }
  }

  // 4) 법령 매칭 - 각 법령은 이미 키워드로 검색됐으므로 _matchedKeyword 사용
  for (const law of recentLaws) {
    const matchedKw = law._matchedKeyword;
    const lawName = law.법령명한글 || law.법령명 || '';
    newAlerts.push({
      id: `law-${law.법령일련번호}-${matchedKw}`,
      type: 'law',
      keyword: matchedKw,
      title: lawName,
      date: law.공포일자,
      dept: law.소관부처명 || '',
      snippet: `${law.제개정구분명 || '개정'} - ${law.소관부처명 || ''} (시행 ${formatDate(law.시행일자)})`,
      lawId: law.법령일련번호,
      createdAt: Date.now(),
    });
  }

  // 5) 중복 제거 (이미 알림에 있는 ID는 제외)
  const existingIds = new Set(dataStore.alertHistory.map(a => a.id));
  const uniqueAlerts = newAlerts.filter(a => !existingIds.has(a.id));

  console.log(`[알림체크] 새 알림: ${uniqueAlerts.length}건 (총 매칭 ${newAlerts.length}건 중)`);

  // 6) 알림 내역에 저장
  dataStore.alertHistory.unshift(...uniqueAlerts);
  // 최근 200건만 유지
  dataStore.alertHistory = dataStore.alertHistory.slice(0, 200);

  // 7) 팀원별로 이메일 발송
  let emailsSent = 0;
  for (const member of dataStore.members.filter(m => m.active && m.email)) {
    // 이 팀원에게 보낼 알림 = 공통 키워드 + 개인 키워드 매칭분
    const memberKeywords = new Set([...dataStore.commonKeywords, ...(member.personalKeywords || [])]);
    const memberAlerts = uniqueAlerts.filter(a => memberKeywords.has(a.keyword));

    if (memberAlerts.length > 0) {
      const sent = await sendKeywordAlertEmail(member, memberAlerts);
      if (sent) emailsSent++;
    }
  }

  dataStore.lastCheckedDate = todayStr;
  saveData();

  const result = {
    newAlerts: uniqueAlerts.length,
    emailsSent,
    keywords: [...allKeywords],
    checkedAt: new Date().toISOString(),
  };

  console.log('[알림체크] 완료:', result);
  return result;
}

function formatDate(d) {
  if (!d || d.length < 8) return d || '';
  return `${d.slice(0,4)}.${d.slice(4,6)}.${d.slice(6,8)}`;
}

// 매일 오전 8시 자동 실행
cron.schedule('0 8 * * *', () => {
  runKeywordAlertCheck().catch(err => console.error('[CRON] 오류:', err.message));
}, { timezone: 'Asia/Seoul' });

console.log('⏰ 키워드 알림 스케줄 등록 완료 (매일 오전 8시, Asia/Seoul)');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`서버 실행 중: http://localhost:${PORT}`));
