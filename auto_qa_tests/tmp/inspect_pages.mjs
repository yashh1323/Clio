import { chromium } from 'file:///playwright';
import { signToken } from '../../frontend/lib/auth.ts';

(async () => {
  const studentToken = signToken({ username: 'student1', role: 'student' });
  const teacherToken = signToken({ username: 'teacher1', role: 'teacher' });

  const browser = await chromium.launch({ headless: true });
  
  // Test Editor
  const studentCtx = await browser.newContext();
  await studentCtx.addCookies([{ name: 'clio_session', value: studentToken, domain: 'localhost', path: '/' }]);
  const studentPage = await studentCtx.newPage();
  await studentPage.goto('http://localhost:3000/editor');
  await studentPage.waitForTimeout(2000);
  console.log('--- Editor Page Elements ---');
  console.log('URL:', studentPage.url());
  const editorVisible = await studentPage.locator('.tiptap').first().isVisible().catch(() => false);
  console.log('TipTap .tiptap visible:', editorVisible);
  const editorContentEditable = await studentPage.locator('div[contenteditable="true"]').first().isVisible().catch(() => false);
  console.log('contenteditable div visible:', editorContentEditable);
  const buttons = await studentPage.locator('button').allTextContents();
  console.log('Buttons on editor page:', buttons);
  const bodyText = await studentPage.locator('body').innerText();
  console.log('Editor body preview:', bodyText.split('\n').filter(Boolean).slice(0, 15));

  // Test Teacher Dashboard
  const teacherCtx = await browser.newContext();
  await teacherCtx.addCookies([{ name: 'clio_session', value: teacherToken, domain: 'localhost', path: '/' }]);
  const teacherPage = await teacherCtx.newPage();
  await teacherPage.goto('http://localhost:3000/dashboard');
  await teacherPage.waitForTimeout(2000);
  console.log('\n--- Teacher Dashboard Elements ---');
  console.log('URL:', teacherPage.url());
  const teacherButtons = await teacherPage.locator('button').allTextContents();
  console.log('Buttons on dashboard page:', teacherButtons);
  const dashBodyText = await teacherPage.locator('body').innerText();
  console.log('Dashboard body preview:', dashBodyText.split('\n').filter(Boolean).slice(0, 15));

  // Test Similarity Page
  await teacherPage.goto('http://localhost:3000/similarity');
  await teacherPage.waitForTimeout(2000);
  console.log('\n--- Teacher Similarity Elements ---');
  console.log('URL:', teacherPage.url());
  const similarityButtons = await teacherPage.locator('button').allTextContents();
  console.log('Buttons on similarity page:', similarityButtons);
  const simBodyText = await teacherPage.locator('body').innerText();
  console.log('Similarity body preview:', simBodyText.split('\n').filter(Boolean).slice(0, 15));

  await browser.close();
})();
