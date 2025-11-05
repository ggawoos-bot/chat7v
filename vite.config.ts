import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import { copyFileSync, mkdirSync, existsSync } from 'fs';

export default defineConfig(({ mode }) => {
    // data 폴더를 public으로 복사
    const copyDataToPublic = () => {
      const dataDir = path.resolve(process.cwd(), 'data');
      const publicDataDir = path.resolve(process.cwd(), 'public', 'data');
      
      try {
        // public/data 디렉토리가 없으면 생성
        if (!existsSync(publicDataDir)) {
          mkdirSync(publicDataDir, { recursive: true });
        }
        
        // data 폴더의 파일들을 public/data로 복사
        if (existsSync(dataDir)) {
          const files = fs.readdirSync(dataDir);
          files.forEach(file => {
            const srcPath = path.join(dataDir, file);
            const destPath = path.join(publicDataDir, file);
            
            // JSON 파일만 복사
            if (file.endsWith('.json')) {
              copyFileSync(srcPath, destPath);
              console.log(`✅ ${file} 복사 완료: ${destPath}`);
            }
          });
        }
      } catch (error) {
        console.error('❌ data 폴더 복사 오류:', error);
      }
    };
    
    // 즉시 실행
    copyDataToPublic();
    
    // .env.local 파일을 직접 읽어보기
    try {
        const envLocalPath = path.resolve(process.cwd(), '.env.local');
        console.log('환경변수 파일 경로:', envLocalPath);
        console.log('파일 존재 여부:', fs.existsSync(envLocalPath));
        
        if (fs.existsSync(envLocalPath)) {
            const envLocalContent = fs.readFileSync(envLocalPath, 'utf8');
            console.log('.env.local 파일 내용:');
            console.log(envLocalContent);
        }
    } catch (error) {
        console.error('.env.local 파일 읽기 오류:', error);
    }
    
    // VITE_ 접두사가 있는 환경변수만 로드
    const env = loadEnv(mode, process.cwd(), 'VITE_');
    
    // 환경변수 디버깅
    console.log('Vite 환경변수 로딩 (VITE_ 접두사):');
    console.log('- VITE_GEMINI_API_KEY:', env.VITE_GEMINI_API_KEY ? '설정됨' : '설정되지 않음');
    console.log('- VITE_GEMINI_API_KEY_1:', env.VITE_GEMINI_API_KEY_1 ? '설정됨' : '설정되지 않음');
    console.log('- VITE_GEMINI_API_KEY_2:', env.VITE_GEMINI_API_KEY_2 ? '설정됨' : '설정되지 않음');
    
    // 모든 환경변수 키 출력
    console.log('사용 가능한 VITE_ 환경변수 키들:', Object.keys(env));
    
    // process.env에서도 확인
    console.log('process.env에서 확인:');
    console.log('- process.env.VITE_GEMINI_API_KEY:', process.env.VITE_GEMINI_API_KEY ? '설정됨' : '설정되지 않음');
    
    return {
      base: './', // GitHub Pages 호환을 위한 상대 경로
      publicDir: 'public',
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY || ''),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY || ''),
        'process.env.VITE_GEMINI_API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY || ''),
        // 여러 API 키들도 안전하게 주입 (빈 문자열 폴백)
        'process.env.VITE_GEMINI_API_KEY_1': JSON.stringify(env.VITE_GEMINI_API_KEY_1 || ''),
        'process.env.VITE_GEMINI_API_KEY_2': JSON.stringify(env.VITE_GEMINI_API_KEY_2 || ''),
        // import.meta.env도 안전하게 주입
        'import.meta.env.VITE_GEMINI_API_KEY': JSON.stringify(env.VITE_GEMINI_API_KEY || ''),
        'import.meta.env.VITE_GEMINI_API_KEY_1': JSON.stringify(env.VITE_GEMINI_API_KEY_1 || ''),
        'import.meta.env.VITE_GEMINI_API_KEY_2': JSON.stringify(env.VITE_GEMINI_API_KEY_2 || '')
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      },
      build: {
        outDir: 'dist',
        assetsDir: 'assets',
        sourcemap: false,
        rollupOptions: {
          input: {
            main: path.resolve(__dirname, 'index.html'),
            admin: path.resolve(__dirname, 'admin.html'),
            chat: path.resolve(__dirname, 'chat_index.html'),
            simple: path.resolve(__dirname, 'simple.html'),
            test: path.resolve(__dirname, 'index2.html'),
            pdfViewer: path.resolve(__dirname, 'pdf-viewer.html')
          }
        }
      }
    };
});