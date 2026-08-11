/**
 * send-reviews.js — 복습 알람 발송 스크립트
 * GitHub Actions 에서 매일 10시(KST)에 실행됨
 *
 * 필요한 GitHub Secrets:
 *   FIREBASE_SERVICE_ACCOUNT  : Firebase 서비스 계정 JSON (전체를 한 줄로)
 *   VAPID_PUBLIC_KEY           : BElhgY-myMZyaZ3dbr4k_...
 *   VAPID_PRIVATE_KEY          : OOck0YVSdytTO60bKzP6...
 *   VAPID_EMAIL                : your@email.com
 */

const admin   = require('firebase-admin');
const webpush = require('web-push');

// ── Firebase 초기화 ───────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ── Web Push VAPID 설정 ───────────────────────────────────
webpush.setVapidDetails(
  `mailto:${process.env.VAPID_EMAIL || 'admin@fittimer.app'}`,
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// ── 메인 실행 ─────────────────────────────────────────────
async function run() {
  // 한국시간 기준 오늘 날짜
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  console.log(`\n[Fit Timer Review] 발송 시작: ${today} (KST)\n`);

  let sentCount  = 0;
  let errorCount = 0;

  // 모든 사용자의 reviews 서브컬렉션 조회
  const usersRef = db.collection('users');
  const usersSnap = await usersRef.listDocuments();

  for (const userRef of usersSnap) {
    try {
      // 오늘 만기인 pending 복습 스케줄 조회
      const reviewsSnap = await userRef
        .collection('reviews')
        .where('dueDate', '==', today)
        .where('status', '==', 'pending')
        .get();

      if (reviewsSnap.empty) continue;

      // 해당 사용자의 push 구독 정보
      const pushDoc     = await userRef.collection('settings').doc('push').get();
      const subscription = pushDoc.exists ? pushDoc.data().subscription : null;

      if (!subscription?.endpoint) {
        console.log(`  [${userRef.id}] 푸시 구독 없음 - 건너뜀`);
        continue;
      }

      // 같은 과목+날짜+주기는 한 번만 알림 (중복 방지)
      // ※ 1일 후 / 1주일 후 / 30일 후는 서로 다른 주기이므로 따로 알림이 감
      const sent = new Set();
      const CYCLE_LABEL = { day1: '1일 후', week1: '1주일 후', month1: '30일 후' };

      for (const doc of reviewsSnap.docs) {
        const r   = doc.data();
        const key = `${r.studiedDate}__${r.subjectName}__${r.type}`;
        if (sent.has(key)) continue;
        sent.add(key);

        const [, m, d] = (r.studiedDate || '').split('-');
        const cycle = CYCLE_LABEL[r.type] || '';
        const body = `${m}월 ${d}일에 공부한 ${r.subjectName} 내용을 복습하실 시간이에요! (${cycle})`;

        const payload = JSON.stringify({
          title: '📚 복습 시간이에요!',
          body,
          icon:  '/icons/icon-192.png',
          badge: '/icons/icon-192.png',
          tag:   `review-${r.studiedDate}-${r.subjectName}-${r.type}`,
          data:  {
            studiedDate: r.studiedDate,
            subjectName: r.subjectName,
            url: '/'
          }
        });

        try {
          await webpush.sendNotification(subscription, payload, { TTL: 43200 });
          console.log(`  ✅ [${userRef.id}] ${r.subjectName} (${r.studiedDate})`);
          sentCount++;
        } catch (pushErr) {
          // 구독이 만료됐으면 Firestore에서 삭제
          if (pushErr.statusCode === 410) {
            console.log(`  ⚠️  [${userRef.id}] 구독 만료 → 삭제`);
            await userRef.collection('settings').doc('push').delete();
          } else {
            console.error(`  ❌ [${userRef.id}] 푸시 실패:`, pushErr.message);
            errorCount++;
          }
        }
      }

    } catch (err) {
      console.error(`  ❌ 사용자 처리 실패 [${userRef.id}]:`, err.message);
      errorCount++;
    }
  }

  console.log(`\n[완료] 발송: ${sentCount}건, 실패: ${errorCount}건`);

  // 실패가 있으면 exit code 1 (GitHub Actions에서 빨간불)
  if (errorCount > 0) process.exit(1);
}

run().catch(err => {
  console.error('[치명적 오류]', err);
  process.exit(1);
});
