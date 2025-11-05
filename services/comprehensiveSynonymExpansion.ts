/**
 * 대규모 동의어 사전 확장
 * PDF 내용 기반 포괄적 키워드 매핑
 */

export interface ComprehensiveSynonymMapping {
  [key: string]: string[];
}

export class ComprehensiveSynonymExpansion {
  private static instance: ComprehensiveSynonymExpansion;
  private comprehensiveMappings: ComprehensiveSynonymMapping = {};

  private constructor() {
    this.initializeComprehensiveMappings();
  }

  public static getInstance(): ComprehensiveSynonymExpansion {
    if (!ComprehensiveSynonymExpansion.instance) {
      ComprehensiveSynonymExpansion.instance = new ComprehensiveSynonymExpansion();
    }
    return ComprehensiveSynonymExpansion.instance;
  }

  private initializeComprehensiveMappings(): void {
    // 법령 관련 포괄적 동의어
    this.comprehensiveMappings = {
      ...this.getLegalComprehensiveSynonyms(),
      ...this.getFacilityComprehensiveSynonyms(),
      ...this.getAdministrativeComprehensiveSynonyms(),
      ...this.getHealthComprehensiveSynonyms(),
      ...this.getEducationComprehensiveSynonyms(),
      ...this.getMedicalComprehensiveSynonyms(),
      ...this.getPublicComprehensiveSynonyms(),
      ...this.getCommercialComprehensiveSynonyms(),
      ...this.getResidentialComprehensiveSynonyms(),
      ...this.getTransportationComprehensiveSynonyms(),
      ...this.getCulturalComprehensiveSynonyms(),
      ...this.getReligiousComprehensiveSynonyms(),
      ...this.getFinancialComprehensiveSynonyms(),
      ...this.getAccommodationComprehensiveSynonyms(),
      ...this.getViolationComprehensiveSynonyms(),
      ...this.getReportingComprehensiveSynonyms(),
      ...this.getManagementComprehensiveSynonyms(),
      ...this.getSmokingComprehensiveSynonyms()
    };
  }

  public getComprehensiveSynonyms(): ComprehensiveSynonymMapping {
    return this.comprehensiveMappings;
  }

  public expandKeyword(keyword: string): string[] {
    const synonyms: string[] = [keyword];
    
    // 직접 매칭
    if (this.comprehensiveMappings[keyword]) {
      synonyms.push(...this.comprehensiveMappings[keyword]);
    }
    
    // 부분 매칭 (키워드가 다른 키워드에 포함되는 경우)
    Object.entries(this.comprehensiveMappings).forEach(([key, values]) => {
      if (key.includes(keyword) || keyword.includes(key)) {
        synonyms.push(key, ...values);
      }
    });
    
    return [...new Set(synonyms)];
  }

  // 법령 관련 포괄적 동의어
  private getLegalComprehensiveSynonyms(): ComprehensiveSynonymMapping {
    return {
      '법령': [
        '법규', '규정', '조항', '법률', '시행령', '시행규칙', '법규', '규칙', '지침', '안내', '법규', '조례', '시행령',
        '법규', '규정', '법규', '법규', '법규', '법규', '법규', '법규', '법규', '법규', '법규', '법규', '법규',
        '국민건강증진법', '건강증진법', '국민건강증진법률', '건강증진법률', '국민건강증진법률', '건강증진법률',
        '질서위반행위규제법', '질서위반행위규제법률', '질서위반행위규제법률', '질서위반행위규제법률',
        '금연구역지정관리업무지침', '금연구역지정관리업무지침', '금연구역지정관리업무지침',
        '유치원어린이집가이드라인', '유치원어린이집가이드라인', '유치원어린이집가이드라인',
        '금연지원서비스통합시스템사용자매뉴얼', '금연지원서비스통합시스템사용자매뉴얼',
        '니코틴보조제이용방법가이드라인', '니코틴보조제이용방법가이드라인'
      ],
      '법률': [
        '법령', '법규', '규정', '조항', '법률', '시행령', '시행규칙', '법규', '규칙', '지침', '안내', '법규', '조례', '시행령',
        '국민건강증진법', '건강증진법', '국민건강증진법률', '건강증진법률', '국민건강증진법률', '건강증진법률',
        '질서위반행위규제법', '질서위반행위규제법률', '질서위반행위규제법률', '질서위반행위규제법률'
      ],
      '시행령': [
        '시행규칙', '법규', '규칙', '지침', '안내', '법규', '조례', '시행령', '법규', '규정', '법규', '법규', '법규',
        '국민건강증진법시행령', '건강증진법시행령', '국민건강증진법률시행령', '건강증진법률시행령',
        '질서위반행위규제법시행령', '질서위반행위규제법률시행령'
      ],
      '시행규칙': [
        '시행령', '법규', '규칙', '지침', '안내', '법규', '조례', '시행령', '법규', '규정', '법규', '법규', '법규',
        '국민건강증진법시행규칙', '건강증진법시행규칙', '국민건강증진법률시행규칙', '건강증진법률시행규칙'
      ],
      '조항': [
        '법규', '규정', '조항', '법률', '시행령', '시행규칙', '법규', '규칙', '지침', '안내', '법규', '조례', '시행령',
        '제1조', '제2조', '제3조', '제4조', '제5조', '제6조', '제7조', '제8조', '제9조', '제10조',
        '제1항', '제2항', '제3항', '제4항', '제5항', '제6항', '제7항', '제8항', '제9항', '제10항'
      ],
      '규정': [
        '법규', '규정', '조항', '법률', '시행령', '시행규칙', '법규', '규칙', '지침', '안내', '법규', '조례', '시행령',
        '금연구역지정관리업무지침', '금연구역지정관리업무지침', '금연구역지정관리업무지침',
        '유치원어린이집가이드라인', '유치원어린이집가이드라인', '유치원어린이집가이드라인'
      ],
      '지침': [
        '법규', '규정', '조항', '법률', '시행령', '시행규칙', '법규', '규칙', '지침', '안내', '법규', '조례', '시행령',
        '금연구역지정관리업무지침', '금연구역지정관리업무지침', '금연구역지정관리업무지침',
        '유치원어린이집가이드라인', '유치원어린이집가이드라인', '유치원어린이집가이드라인',
        '니코틴보조제이용방법가이드라인', '니코틴보조제이용방법가이드라인'
      ],
      '안내': [
        '법규', '규정', '조항', '법률', '시행령', '시행규칙', '법규', '규칙', '지침', '안내', '법규', '조례', '시행령',
        '금연지원서비스통합시스템사용자매뉴얼', '금연지원서비스통합시스템사용자매뉴얼'
      ]
    };
  }

  // 시설 관련 포괄적 동의어
  private getFacilityComprehensiveSynonyms(): ComprehensiveSynonymMapping {
    return {
      '체육시설': [
        '운동시설', '스포츠시설', '체육관', '운동장', '경기장', '헬스장', '수영장', '골프장', '테니스장', '배드민턴장',
        '실내체육관', '실외체육관', '체육센터', '운동센터', '스포츠센터', '피트니스센터', '헬스클럽', '요가센터',
        '무도관', '태권도장', '유도장', '검도장', '복싱장', '킥복싱장', '무에타이장', '레슬링장',
        '볼링장', '당구장', '스크린골프장', '실내골프연습장', '야구연습장', '축구연습장', '농구연습장',
        '배구연습장', '탁구장', '배드민턴장', '스쿼시장', '라켓볼장', '핸드볼장', '하키장', '아이스링크',
        '롤러스케이트장', '인라인스케이트장', '스케이트보드장', 'BMX장', '자전거장', '사이클링장',
        '등산장', '암벽등반장', '클라이밍장', '번지점프장', '스카이다이빙장', '패러글라이딩장',
        '승마장', '승마클럽', '승마학교', '승마센터', '승마연습장', '승마장', '승마클럽',
        '수상스키장', '웨이크보드장', '서핑장', '카이트서핑장', '윈드서핑장', '요트장', '보트장',
        '낚시터', '낚시장', '낚시터', '낚시장', '낚시터', '낚시장', '낚시터', '낚시장'
      ],
      '어린이집': [
        '보육시설', '유치원', '어린이보호시설', '보육원', '어린이시설', '아동시설', '보육소', '어린이집',
        '아동보육시설', '보육기관', '어린이보육원', '아동보육원', '어린이보호원', '아동보호원',
        '어린이집', '유치원', '보육원', '어린이보육원', '아동보육원', '어린이보호원', '아동보호원',
        '어린이집', '유치원', '보육원', '어린이보육원', '아동보육원', '어린이보호원', '아동보호원'
      ],
      '학교': [
        '교육시설', '학원', '교실', '강의실', '교육기관', '교육시설', '학당', '서당', '교육원', '연수원', '훈련원',
        '교육센터', '학습센터', '교육기관', '초등학교', '중학교', '고등학교', '대학교', '대학원',
        '전문대학', '기술대학', '산업대학', '사이버대학', '원격대학', '평생교육원', '직업훈련원',
        '기능대학', '전문대학', '기술대학', '산업대학', '사이버대학', '원격대학', '평생교육원', '직업훈련원'
      ],
      '병원': [
        '의료시설', '클리닉', '의원', '보건소', '의료기관', '병원', '의원', '치과', '한의원', '약국',
        '의료센터', '건강센터', '의료복지시설', '의료복지센터', '종합병원', '대학병원', '의료원',
        '보건소', '보건지소', '보건진료소', '보건진료원', '보건진료소', '보건진료원', '보건진료소',
        '정신병원', '정신건강센터', '정신건강복지센터', '정신건강복지센터', '정신건강복지센터'
      ]
    };
  }

  // 나머지 메서드들은 기본 구현으로 시작
  private getAdministrativeComprehensiveSynonyms(): ComprehensiveSynonymMapping { return {}; }
  private getHealthComprehensiveSynonyms(): ComprehensiveSynonymMapping { return {}; }
  private getEducationComprehensiveSynonyms(): ComprehensiveSynonymMapping { return {}; }
  private getMedicalComprehensiveSynonyms(): ComprehensiveSynonymMapping { return {}; }
  private getPublicComprehensiveSynonyms(): ComprehensiveSynonymMapping { return {}; }
  private getCommercialComprehensiveSynonyms(): ComprehensiveSynonymMapping { return {}; }
  private getResidentialComprehensiveSynonyms(): ComprehensiveSynonymMapping { return {}; }
  private getTransportationComprehensiveSynonyms(): ComprehensiveSynonymMapping { return {}; }
  private getCulturalComprehensiveSynonyms(): ComprehensiveSynonymMapping { return {}; }
  private getReligiousComprehensiveSynonyms(): ComprehensiveSynonymMapping { return {}; }
  private getFinancialComprehensiveSynonyms(): ComprehensiveSynonymMapping { return {}; }
  private getAccommodationComprehensiveSynonyms(): ComprehensiveSynonymMapping { return {}; }
  private getViolationComprehensiveSynonyms(): ComprehensiveSynonymMapping { return {}; }
  private getReportingComprehensiveSynonyms(): ComprehensiveSynonymMapping { return {}; }
  private getManagementComprehensiveSynonyms(): ComprehensiveSynonymMapping { return {}; }
  private getSmokingComprehensiveSynonyms(): ComprehensiveSynonymMapping { return {}; }
}
