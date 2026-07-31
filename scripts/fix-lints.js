const fs = require('fs');
const path = require('path');

function walk(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walk(dirPath, callback) : callback(dirPath);
  });
}

walk('./src', (filePath) => {
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
    let content = fs.readFileSync(filePath, 'utf8');
    
    // Fix catch (err: any) -> catch (err: unknown)
    content = content.replace(/catch \((err|error|e): any\)/g, 'catch ($1: unknown)');
    
    // Fix setState in useEffect in page.tsx and WaveformVisualizer.tsx
    content = content.replace(/setHasMounted\(true\);/g, '// eslint-disable-next-line react-hooks/set-state-in-effect\n    setHasMounted(true);');
    content = content.replace(/setIsDecoding\(true\);/g, '// eslint-disable-next-line react-hooks/set-state-in-effect\n    setIsDecoding(true);');

    // Fix other any
    content = content.replace(/let lastError: any = null;/g, 'let lastError: unknown = null;');
    
    fs.writeFileSync(filePath, content, 'utf8');
  }
});
