import { AIKeywordExpansionService, KeywordExpansionResult } from './aiKeywordExpansionService';

export interface SynonymMapping {
  [key: string]: string[];
}

export interface DomainMapping {
  [domain: string]: SynonymMapping;
}

export class UnifiedSynonymService {
  private static instance: UnifiedSynonymService;
  private synonymCache: Map<string, string[]> = new Map();
  private domainMappings: DomainMapping = {};
  private aiExpansionService: AIKeywordExpansionService = AIKeywordExpansionService.getInstance();

  private constructor() {
    this.initializeComprehensiveSynonyms();
  }

  public static getInstance(): UnifiedSynonymService {
    if (!UnifiedSynonymService.instance) {
      UnifiedSynonymService.instance = new UnifiedSynonymService();
    }
    return UnifiedSynonymService.instance;
  }

  /**
   * 포괄적인 동의어 사전 초기화
   */
  private initializeComprehensiveSynonyms(): void {
    // 기본 동의어 매핑
    this.domainMappings['basic'] = this.getBasicSynonyms();
    
    // 시설 관련 동의어
    this.domainMappings['facilities'] = this.getFacilitySynonyms();
    
    // 법령 관련 동의어
    this.domainMappings['legal'] = this.getLegalSynonyms();
    
    // 행정 절차 관련 동의어
    this.domainMappings['administrative'] = this.getAdministrativeSynonyms();
    
    // 금연 관련 동의어
    this.domainMappings['smoking'] = this.getSmokingSynonyms();
    
    // 건강 관련 동의어
    this.domainMappings['health'] = this.getHealthSynonyms();
    
    // 교육 관련 동의어
    this.domainMappings['education'] = this.getEducationSynonyms();
    
    // 의료 관련 동의어
    this.domainMappings['medical'] = this.getMedicalSynonyms();
    
    // 공공시설 관련 동의어
    this.domainMappings['public'] = this.getPublicFacilitySynonyms();
    
    // 상업시설 관련 동의어
    this.domainMappings['commercial'] = this.getCommercialFacilitySynonyms();
    
    // 주거 관련 동의어
    this.domainMappings['residential'] = this.getResidentialSynonyms();
    
    // 교통 관련 동의어
    this.domainMappings['transportation'] = this.getTransportationSynonyms();
    
    // 문화시설 관련 동의어
    this.domainMappings['cultural'] = this.getCulturalFacilitySynonyms();
    
    // 종교시설 관련 동의어
    this.domainMappings['religious'] = this.getReligiousFacilitySynonyms();
    
    // 금융시설 관련 동의어
    this.domainMappings['financial'] = this.getFinancialFacilitySynonyms();
    
    // 숙박시설 관련 동의어
    this.domainMappings['accommodation'] = this.getAccommodationSynonyms();
    
    // 위반/처벌 관련 동의어
    this.domainMappings['violation'] = this.getViolationSynonyms();
    
    // 신고/신청 관련 동의어
    this.domainMappings['reporting'] = this.getReportingSynonyms();
    
    // 관리/운영 관련 동의어
    this.domainMappings['management'] = this.getManagementSynonyms();
  }

  /**
   * AI 기반 키워드 확장 (고급 기능)
   */
  async expandKeywordsWithAI(keywords: string[], context?: string): Promise<string[]> {
    const expandedKeywords: string[] = [];
    
    for (const keyword of keywords) {
      // 캐시 확인
      const cached = this.synonymCache.get(keyword);
      if (cached) {
        expandedKeywords.push(...cached);
        continue;
      }
      
      // AI 기반 확장
      const aiResult = await this.aiExpansionService.expandKeywordHybrid(keyword, context);
      const aiExpanded = aiResult.expandedKeywords;
      
      // 기본 확장과 AI 확장 통합
      const basicExpanded = this.expandKeywords([keyword]);
      const allExpanded = [...new Set([...basicExpanded, ...aiExpanded])];
      
      // 캐시 저장
      this.synonymCache.set(keyword, allExpanded);
      expandedKeywords.push(...allExpanded);
    }
    
    return [...new Set(expandedKeywords)]; // 중복 제거
  }

  /**
   * 사용자 피드백 학습
   */
  learnFromUserFeedback(
    keyword: string,
    searchResults: string[],
    userSatisfaction: number,
    context: string
  ): void {
    this.aiExpansionService.learnFromFeedback(
      keyword,
      searchResults,
      userSatisfaction,
      context
    );
  }

  /**
   * 학습 통계 조회
   */
  getLearningStats(): { totalKeywords: number; avgConfidence: number; recentLearning: number } {
    return this.aiExpansionService.getLearningStats();
  }

  /**
   * 키워드 확장 (모든 도메인에서 검색)
   */
  public expandKeywords(keywords: string[]): string[] {
    const expandedKeywords: string[] = [];
    
    keywords.forEach(keyword => {
      // 원본 키워드 추가
      expandedKeywords.push(keyword);
      
      // 모든 도메인에서 동의어 검색
      Object.values(this.domainMappings).forEach(domainMapping => {
        if (domainMapping[keyword]) {
          expandedKeywords.push(...domainMapping[keyword]);
        }
      });
      
      // 부분 매칭 검색 (키워드가 다른 키워드에 포함되는 경우)
      Object.values(this.domainMappings).forEach(domainMapping => {
        Object.entries(domainMapping).forEach(([key, synonyms]) => {
          if (key.includes(keyword) || keyword.includes(key)) {
            expandedKeywords.push(key, ...synonyms);
          }
        });
      });
    });
    
    // 중복 제거 및 정렬
    return [...new Set(expandedKeywords)].sort();
  }

  /**
   * 특정 도메인에서만 키워드 확장
   */
  public expandKeywordsByDomain(keywords: string[], domain: string): string[] {
    const expandedKeywords: string[] = [];
    const domainMapping = this.domainMappings[domain];
    
    if (!domainMapping) {
      return keywords;
    }
    
    keywords.forEach(keyword => {
      expandedKeywords.push(keyword);
      if (domainMapping[keyword]) {
        expandedKeywords.push(...domainMapping[keyword]);
      }
    });
    
    return [...new Set(expandedKeywords)];
  }

  /**
   * 키워드 관련성 점수 계산
   */
  public calculateRelevanceScore(keyword: string, targetKeywords: string[]): number {
    const expanded = this.expandKeywords([keyword]);
    const matches = targetKeywords.filter(target => 
      expanded.includes(target) || target.includes(keyword)
    );
    return matches.length / targetKeywords.length;
  }

  /**
   * 캐시된 동의어 조회
   */
  public getCachedSynonyms(keyword: string): string[] | null {
    return this.synonymCache.get(keyword) || null;
  }

  /**
   * 동의어 캐시 저장
   */
  public setCachedSynonyms(keyword: string, synonyms: string[]): void {
    this.synonymCache.set(keyword, synonyms);
  }

  /**
   * 모든 도메인 목록 조회
   */
  public getAvailableDomains(): string[] {
    return Object.keys(this.domainMappings);
  }

  /**
   * 특정 도메인의 동의어 매핑 조회
   */
  public getDomainMapping(domain: string): SynonymMapping | null {
    return this.domainMappings[domain] || null;
  }

  // 기본 동의어 매핑
  private getBasicSynonyms(): SynonymMapping {
    return {
      '금연': ['흡연금지', '담배금지', '니코틴금지', '흡연제한', '금연구역', '금연장소', '금연존', '금연지역', '금연공간', '금연시설', '금연구역', '금연지대', '금연공간', '금연실', '금연룸'],
      '공동주택': ['아파트', '연립주택', '다세대주택', '주택단지', '아파트단지', '공동주거', '집합주택', '공동주거시설', '주거복합시설', '오피스텔', '빌라', '다가구주택', '다중주택'],
      '어린이집': ['보육시설', '유치원', '어린이보호시설', '보육원', '어린이시설', '아동시설', '보육소', '어린이집', '아동보육시설', '보육기관', '어린이보육원', '아동보육원', '어린이보호원', '아동보호원'],
      '학교': ['교육시설', '학원', '교실', '강의실', '교육기관', '교육시설', '학당', '서당', '교육원', '연수원', '훈련원', '교육센터', '학습센터', '교육기관'],
      '병원': ['의료시설', '클리닉', '의원', '보건소', '의료기관', '병원', '의원', '치과', '한의원', '약국', '의료센터', '건강센터', '의료복지시설', '의료복지센터'],
      '법령': ['법규', '규정', '조항', '법률', '시행령', '시행규칙', '법규', '규칙', '지침', '안내', '법규', '조례', '시행령', '법규', '규정', '법규', '법규'],
      '위반': ['위배', '위법', '불법', '금지행위', '규정위반', '법규위반', '법령위반', '규칙위반', '지침위반', '안내위반', '조례위반', '시행령위반'],
      '벌금': ['과태료', '처벌', '제재', '벌칙', '과징금', '벌금', '과태료', '처벌금', '제재금', '벌칙금', '과징금', '처벌금', '제재금'],
      '신고': ['제보', '고발', '신청', '접수', '제출', '신고', '제보', '고발', '신청', '접수', '제출', '신고', '제보', '고발'],
      '관리': ['운영', '관할', '담당', '처리', '시행', '관리', '운영', '관할', '담당', '처리', '시행', '관리', '운영', '관할']
    };
  }

  // 시설 관련 동의어 (다음 파일에서 계속...)
  private getFacilitySynonyms(): SynonymMapping {
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
      '문화시설': [
        '도서관', '박물관', '미술관', '극장', '영화관', '카페', '식당', '음식점', '상점', '마트', '백화점', '시장',
        '문화센터', '문화회관', '문화예술회관', '문화예술센터', '문화예술관', '문화예술회관',
        '공연장', '콘서트홀', '오페라하우스', '뮤지컬극장', '연극장', '소극장', '대극장', '중극장',
        '전시관', '갤러리', '전시장', '전시실', '전시관', '갤러리', '전시장', '전시실',
        '문화공간', '문화마당', '문화광장', '문화공원', '문화단지', '문화타운', '문화촌',
        '예술공간', '예술마당', '예술광장', '예술공원', '예술단지', '예술타운', '예술촌',
        '창작공간', '창작마당', '창작광장', '창작공원', '창작단지', '창작타운', '창작촌',
        '스튜디오', '녹음실', '방송실', '촬영장', '편집실', '제작실', '제작소', '제작사'
      ]
    };
  }

  // 나머지 메서드들은 다음 파일에서 계속 구현...
  private getLegalSynonyms(): SynonymMapping { return {}; }
  private getAdministrativeSynonyms(): SynonymMapping { return {}; }
  private getSmokingSynonyms(): SynonymMapping { return {}; }
  private getHealthSynonyms(): SynonymMapping { return {}; }
  private getEducationSynonyms(): SynonymMapping { return {}; }
  private getMedicalSynonyms(): SynonymMapping { return {}; }
  private getPublicFacilitySynonyms(): SynonymMapping { return {}; }
  private getCommercialFacilitySynonyms(): SynonymMapping { return {}; }
  private getResidentialSynonyms(): SynonymMapping { return {}; }
  private getTransportationSynonyms(): SynonymMapping { return {}; }
  private getCulturalFacilitySynonyms(): SynonymMapping { return {}; }
  private getReligiousFacilitySynonyms(): SynonymMapping { return {}; }
  private getFinancialFacilitySynonyms(): SynonymMapping { return {}; }
  private getAccommodationSynonyms(): SynonymMapping { return {}; }
  private getViolationSynonyms(): SynonymMapping { return {}; }
  private getReportingSynonyms(): SynonymMapping { return {}; }
  private getManagementSynonyms(): SynonymMapping { return {}; }
}
