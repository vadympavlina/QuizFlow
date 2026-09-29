// Сид для сторінки тесту: один тест з питаннями всіх 7 типів і посилання LX
export function tseed(){
  const Q = [
    { id: 'q1', type: 'single', text: 'Яка планета найближча до Сонця?', options: ['Венера', 'Меркурій', 'Марс', 'Земля'], correct: 1, points: 1 },
    { id: 'q2', type: 'multi', text: 'Оберіть <b>усі</b> парні числа', options: ['2', '3', '8', '11', '14'], correct: [0, 2, 4], points: 1 },
    { id: 'q3', type: 'text', text: 'Як називається столиця Франції?', correct: 'Париж', points: 1 },
    { id: 'q4', type: 'number', text: 'Скільки буде 7 × 8?', correct: 56, points: 1 },
    { id: 'q5', type: 'matching', text: 'Зіставте країну і столицю', pairs: [{ left: 'Україна', options: ['Київ', 'Львів', 'Одеса'], correct: 0 }, { left: 'Польща', options: ['Краків', 'Варшава', 'Гданськ'], correct: 1 }], points: 1 },
    { id: 'q6', type: 'ordering', text: 'Розставте числа за зростанням', items: ['1', '5', '10', '50'], points: 1 },
    { id: 'q7', type: 'long', text: 'Поясніть власними словами, що таке фотосинтез і навіщо він рослинам.', points: 2 },
  ];
  return {
    users: { t1: { role: 'teacher', name: 'Олена', surname: 'Коваль' } },
    teachers: { t1: {
      tests: { TX: { title: 'Природознавство: підсумкова', status: 'active', timeLimit: 900, questions: Q } },
      links: { LX: { testId: 'TX', status: 'active', group: 'ІП-21' } },
    } },
  };
}
