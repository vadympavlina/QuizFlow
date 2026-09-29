// Вбудовує логотип листів у код воркера (worker/src/logo.js), щоб воркер сам
// віддавав його за адресою /logo.png: картинки з quizflow.space поштові проксі
// (Gmail) можуть не отримати через захист домену.  npm run worker:logo
import fs from "node:fs";
const png = fs.readFileSync(new URL("../../assets/email/logo-light.png", import.meta.url));
fs.writeFileSync(new URL("../../worker/src/logo.js", import.meta.url),
  `// Згенеровано з assets/email/logo-light.png командою  cd tests && npm run worker:logo\nexport const LOGO_PNG_B64 = "${png.toString("base64")}";\n`);
console.log(`logo.js: ${png.length} байт PNG`);
