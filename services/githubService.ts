/**
 * GitHub API 연동 서비스 (읽기 전용)
 * PDF 파일 목록 조회 및 GitHub Actions 트리거 기능 제공
 * 파일 업로드/삭제는 GitHub Web Interface를 통해 처리
 */

interface PDFFile {
  name: string;
  size: number;
  lastModified: string;
}

interface ProcessingSettings {
  chunkSize: number;
  overlapSize: number;
}

interface GitHubFile {
  name: string;
  path: string;
  sha: string;
  size: number;
  download_url: string;
}

class GitHubService {
  private owner: string;
  private repo: string;
  private baseUrl: string;

  constructor() {
    this.owner = 'ggawoos-bot';
    this.repo = 'chat7v';
    this.baseUrl = `https://api.github.com/repos/${this.owner}/${this.repo}`;
  }

  /**
   * GitHub API 요청 헤더 생성 (읽기 전용)
   */
  private getHeaders(): HeadersInit {
    return {
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    };
  }

  /**
   * 현재 업로드된 PDF 파일 목록 조회
   */
  async getPdfFiles(): Promise<PDFFile[]> {
    try {
      const response = await fetch(`${this.baseUrl}/contents/public/pdf/manifest.json`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        if (response.status === 404) {
          return []; // manifest.json이 없으면 빈 배열 반환
        }
        throw new Error(`GitHub API 오류: ${response.status}`);
      }

      const manifestData = await response.json();
      const manifest = JSON.parse(atob(manifestData.content));

      // PDF 파일들의 상세 정보 조회
      const pdfFiles: PDFFile[] = [];
      
      for (const fileName of manifest) {
        try {
          const fileResponse = await fetch(`${this.baseUrl}/contents/public/pdf/${fileName}`, {
            headers: this.getHeaders(),
          });

          if (fileResponse.ok) {
            const fileData: GitHubFile = await fileResponse.json();
            pdfFiles.push({
              name: fileName,
              size: fileData.size,
              lastModified: fileData.download_url, // GitHub에서는 lastModified를 직접 제공하지 않음
            });
          }
        } catch (error) {
          console.warn(`파일 ${fileName} 정보 조회 실패:`, error);
        }
      }

      return pdfFiles;
    } catch (error) {
      console.error('PDF 파일 목록 조회 실패:', error);
      throw error;
    }
  }

  /**
   * PDF 파일 업로드/삭제는 GitHub Web Interface를 통해 처리됩니다.
   * 이 메서드들은 보안상의 이유로 제거되었습니다.
   */

  /**
   * PDF 처리 GitHub Actions 트리거 (읽기 전용)
   * 실제 트리거는 admin.html에서 직접 처리됩니다.
   */
  async triggerPdfProcessing(settings: ProcessingSettings): Promise<void> {
    console.log('PDF 처리 설정:', settings);
    console.log('GitHub Actions 트리거는 admin.html에서 직접 처리됩니다.');
    
    // 실제 구현은 admin.html의 handleProcessPdfs 함수에서 처리
    throw new Error('이 메서드는 더 이상 사용되지 않습니다. admin.html에서 직접 처리하세요.');
  }

  /**
   * 파일 업로드 관련 메서드들은 제거되었습니다.
   * GitHub Web Interface를 통해 파일을 관리하세요.
   */

  /**
   * GitHub Actions 워크플로우 상태 조회
   */
  async getWorkflowStatus(): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/actions/runs?per_page=5`, {
        headers: this.getHeaders(),
      });

      if (!response.ok) {
        throw new Error(`워크플로우 상태 조회 실패: ${response.status}`);
      }

      const data = await response.json();
      return data.workflow_runs;
    } catch (error) {
      console.error('워크플로우 상태 조회 실패:', error);
      throw error;
    }
  }
}

export const githubService = new GitHubService();
