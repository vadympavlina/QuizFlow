// Багатий сид: 4 тести з питаннями, 3 групи, ~60 спроб з відповідями
export function rich(now){
  const D = 864e5;
  const QS = {
    T1: ['Яка столиця Франції?', 'Скільки континентів на Землі?', 'Найдовша річка світу?', 'Найвища гора Європи?', 'В якому океані Мадагаскар?', 'Яка найбільша країна за площею?', 'Столиця Австралії?', 'Яке море найсолоніше?'],
    T2: ['Що таке змінна в Python?', 'Як оголосити функцію?', 'Що повертає len([1,2,3])?', 'Який тип у True?', 'Як створити список?', 'Що робить range(3)?'],
    T3: ['Хто був першим гетьманом?', 'Рік Переяславської ради?', 'Хто написав «Енеїду»?', 'Столиця Гетьманщини?', 'Що таке Запорізька Січ?', 'Коли зруйнували Січ?', 'Хто такий Мазепа?', 'Битва під Конотопом — рік?', 'Що таке універсал?', 'Хто автор Конституції 1710?'],
    T4: ['Що таке клітина?', 'Функція мітохондрій?', 'Що таке фотосинтез?', 'Опишіть власними словами роль ДНК'],
  };
  const tests = {}; const titles = { T1: 'Географія світу', T2: 'Основи Python', T3: 'Історія: Козацька доба', T4: 'Біологія клітини' };
  for (const [id, arr] of Object.entries(QS)) tests[id] = { title: titles[id], status: 'published', createdAt: now - 60 * D,
    questions: arr.map((text, i) => id === 'T4' && i === 3 ? { id: id + 'q' + i, type: 'long', text, points: 2 } : { id: id + 'q' + i, type: 'single', text, options: ['Варіант А', 'Варіант Б', 'Варіант В', 'Варіант Г'], correct: i % 4, points: 1 }) };
  const people = { 'ІП-21': [['Коваль','Олена'],['Петренко','Іван'],['Шевчук','Олег'],['Бондар','Марія'],['Ткаченко','Андрій'],['Мельник','Софія'],['Кравець','Дмитро'],['Лисенко','Анна'],['Савченко','Максим'],['Руденко','Юлія'],['Олійник','Богдан'],['Гончаренко','Катерина']],
    'ПК-22': [['Мороз','Віктор'],['Бойко','Дарина'],['Кузьменко','Артем'],['Павленко','Ірина'],['Литвиненко','Назар'],['Марченко','Вікторія'],['Остапенко','Роман'],['Захарченко','Аліна']],
    'КН-31': [['Сидоренко','Тарас'],['Яковенко','Олександра'],['Васильченко','Денис'],['Поліщук','Христина'],['Карпенко','Євген']] };
  const links = { L1: { testId: 'T1', group: 'ІП-21', status: 'active' }, L2: { testId: 'T2', group: 'ІП-21', status: 'active' }, L3: { testId: 'T3', group: 'ІП-21', status: 'active' }, L4: { testId: 'T4', group: 'ІП-21', status: 'active' },
    L5: { testId: 'T1', group: 'ПК-22', status: 'active' }, L6: { testId: 'T2', group: 'ПК-22', status: 'active' }, L7: { testId: 'T3', group: 'КН-31', status: 'active' }, L8: { testId: 'T2', group: 'КН-31', status: 'active' } };
  const attempts = {}, students = {}, studentIndex = {}; let n = 0, seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const [lid, l] of Object.entries(links)){
    const t = tests[l.testId];
    people[l.group].forEach(([surname, name], pi) => {
      if (rnd() < .12) return;
      const skill = .35 + ((pi * 37) % 60) / 100;
      const tries = rnd() < .15 ? 2 : 1;
      for (let k = 0; k < tries; k++){
        const id = 'a' + (++n);
        const details = [], answers = [];
        let ok = 0;
        t.questions.forEach((q, qi) => {
          if (q.type === 'long'){ answers.push({ questionId: q.id, value: 'ДНК зберігає спадкову інформацію і передає її нащадкам під час поділу клітини.' }); details.push(n % 3 ? { points: 2, longResult: 'correct' } : {}); return; }
          const good = rnd() < skill + k * .1; const v = good ? q.correct : (q.correct + 1) % 4;
          if (good) ok++;
          answers.push({ questionId: q.id, value: v, correct: good }); details.push({ points: good ? 1 : 0 });
        });
        const pct = Math.round(ok / t.questions.length * 100);
        const pending = l.testId === 'T4' && !(n % 3);
        const when = now - (Math.floor(rnd() * 50) * D) - Math.floor(rnd() * 8) * 36e5;
        attempts[id] = { name, surname, testId: l.testId, linkId: lid, group: l.group, status: pending ? 'pending_review' : 'completed', grade12: pending ? null : Math.max(1, Math.round(pct / 100 * 12)),
          createdAt: when - 12 * 6e4, startedAt: when - 12 * 6e4, finishedAt: when, score: { percent: pct, correct: ok, total: t.questions.length, details }, answers,
          ...(n === 5 ? { personalAnalysis: 'Олена добре орієнтується у фізичній географії, але плутає столиці: Канберра — столиця Австралії, а не Сідней.\n\nВарто повторити:\n• столиці країн Океанії;\n• найбільші річки за довжиною (Ніл і Амазонка).\n\nПорада: складіть собі картки «країна — столиця» і проганяйте їх по 5 хвилин щодня.' } : {}),
          ...(n % 11 === 0 ? { tabSwitches: 4 } : {}) };
        const key = (surname + '_' + name).toLowerCase();
        const sid = studentIndex[key] || ('S' + Object.keys(students).length);
        studentIndex[key] = sid;
        students[sid] ||= { name, surname, groups: [l.group], attempts: [] };
        if (!students[sid].groups.includes(l.group)) students[sid].groups.push(l.group);
        students[sid].attempts.push({ attemptId: id, grade: attempts[id].grade12, testId: l.testId, date: when });
      }
    });
  }
  return {
    users: { t1: { role: 'teacher', name: 'Олена', surname: 'Коваль', login: 'o.koval' },
      t2: { role: 'teacher', name: 'Андрій', surname: 'Мельник', login: 'a.melnyk', email: 'a.melnyk@itstep.org' },
      t3: { role: 'teacher', name: 'Ірина', surname: 'Шевченко', login: 'i.shevchenko', email: 'shevchenko@itstep.org' },
      t4: { role: 'teacher', name: 'Андрій', surname: 'Мельниченко', email: 'melnychenko@gmail.com' },
      t5: { role: 'admin', name: 'Адмін', surname: 'Тестовий', login: 'admin' } },
    teachers: { t1: { tests, links, attempts, students, studentIndex } },
  };
}
