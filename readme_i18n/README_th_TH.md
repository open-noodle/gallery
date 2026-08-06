<p align="center"> 
  <br/>  
  <a href="https://opensource.org/license/agpl-v3"><img src="https://img.shields.io/badge/License-AGPL_v3-blue.svg?color=3F51B5&style=for-the-badge&label=License&logoColor=000000&labelColor=ececec" alt="License: AGPLv3"></a>
  <a href="https://discord.gg/cxBfbuxyG4">
    <img src="https://img.shields.io/discord/1480633426376921239.svg?label=Discord&logo=Discord&style=for-the-badge&logoColor=000000&labelColor=ececec" alt="Discord"/>
  </a>
  <br/>  
  <br/>   
</p>

<p align="center">
  <img src="../design/gallery-logo-stacked-light.svg" width="300" title="การเข้าสู่ระบบด้วย URL แบบกำหนดเอง">
</p>

<h3 align="center">โซลูชันการจัดการภาพถ่ายและวิดีโอแบบโฮสต์เองที่มีประสิทธิภาพสูง</h3>
<br/>

<a href="https://opennoodle.de">
  <img src="../design/gallery-screenshot.webp" title="ภาพหน้าจอหลัก">
</a>
<br/>

<p align="center">
  <a href="../README.md">English</a>
  <a href="README_ca_ES.md">Català</a>
  <a href="README_es_ES.md">Español</a>
  <a href="README_fr_FR.md">Français</a>
  <a href="README_it_IT.md">Italiano</a>
  <a href="README_ja_JP.md">日本語</a>
  <a href="README_ko_KR.md">한국어</a>
  <a href="README_de_DE.md">Deutsch</a>
  <a href="README_nl_NL.md">Nederlands</a>
  <a href="README_tr_TR.md">Türkçe</a>
  <a href="README_zh_CN.md">简体中文</a>
  <a href="README_zh_TW.md">正體中文</a>
  <a href="README_uk_UA.md">Українська</a>
  <a href="README_ru_RU.md">Русский</a>
  <a href="README_bg_BG.md">Български</a>
  <a href="README_pt_BR.md">Português Brasileiro</a>
  <a href="README_sv_SE.md">Svenska</a>
  <a href="README_ar_JO.md">العربية</a>
  <a href="README_vi_VN.md">Tiếng Việt</a>
  <a href="README_ml_IN.md">മലയാളം</a>
</p>

> [!NOTE]
> นี่คือ**ฟอร์กชุมชน**ของ [Immich](https://github.com/immich-app/immich) ที่มีฟีเจอร์เพิ่มเติม สำหรับ Docker images คำแนะนำการเปลี่ยนมาใช้ และรายการเปลี่ยนแปลงทั้งหมด โปรดดูที่ [README หลัก](../README.md)

> [!WARNING]
> ⚠️ ปฏิบัติตามแผนการสำรองข้อมูลแบบ [3-2-1](https://www.backblaze.com/blog/the-3-2-1-backup-strategy/) สำหรับภาพถ่ายและวิดีโอที่สำคัญของคุณอยู่เสมอ
> 


> [!NOTE]
> คุณสามารถหาคู่มือหลัก รวมถึงคู่มือการติดตั้ง ได้ที่ https://opennoodle.de/

## ลิงก์

- [คู่มือ](https://docs.opennoodle.de)
- [เกี่ยวกับ](https://docs.opennoodle.de/overview/quick-start)
- [การติดตั้ง](https://docs.opennoodle.de/install/requirements)
- [โรดแมป](https://opennoodle.de/roadmap)
- [สาธิต](#สาธิต)
- [คุณสมบัติ](#คุณสมบัติ)
- [การแปลภาษา](https://docs.opennoodle.de/developer/translations)
- [สนับสนุนโพรเจกต์](https://docs.opennoodle.de/overview/support-the-project)

## สาธิต

เข้าถึงการสาธิตได้ [ที่นี่](https://demo.opennoodle.de) สำหรับแอปมือถือ คุณสามารถใช้ `https://demo.opennoodle.de` เป็น `Server Endpoint URL`

## คุณสมบัติ

| คุณสมบัติ                                  | มือถือ | เว็บ   |
| :----------------------------------------- | ------ | ------ |
| อัปโหลดและดูวิดีโอและภาพถ่าย               | ใช่    | ใช่    |
| การสำรองข้อมูลอัตโนมัติเมื่อเปิดแอป        | ใช่    | N/A    |
| ป้องกันการซ้ำของไฟล์                   | ใช่    | ใช่    |
| เลือกอัลบั้มสำหรับสำรองข้อมูล              | ใช่    | N/A    |
| ดาวน์โหลดภาพถ่ายและวิดีโอไปยังอุปกรณ์      | ใช่    | ใช่    |
| รองรับผู้ใช้หลายคน                         | ใช่    | ใช่    |
| อัลบั้มและอัลบั้มแชร์                      | ใช่    | ใช่    |
| แถบเลื่อนแบบลากได้                         | ใช่    | ใช่    |
| รองรับรูปแบบไฟล์ RAW                       | ใช่    | ใช่    |
| ดูข้อมูลเมตาดาต้า (EXIF, แผนที่)                | ใช่    | ใช่    |
| ค้นหาจากข้อมูลเมตาดาต้า วัตถุ ใบหน้า และ CLIP   | ใช่    | ใช่    |
| ฟังก์ชันการจัดการผู้ดูแลระบบ               | ไม่ใช่ | ใช่    |
| การสำรองข้อมูลพื้นหลัง                     | ใช่    | N/A    |
| การเลื่อนแบบเสมือน                         | ใช่    | ใช่    |
| รองรับ OAuth                               | ใช่    | ใช่    |
| คีย์ API                                   | N/A    | ใช่    |
| การสำรองและเล่น LivePhoto/MotionPhoto      | ใช่    | ใช่    |
| รองรับการแสดงภาพ 360 องศา                  | ไม่ใช่ | ใช่    |
| โครงสร้างการจัดเก็บข้อมูลที่ผู้ใช้กำหนดเอง | ใช่    | ใช่    |
| การแชร์สาธารณะ                             | ใช่    | ใช่    |
| การจัดเก็บและรายการโปรด                    | ใช่    | ใช่    |
| แผนที่ทั่วโลก                              | ใช่    | ใช่    |
| การแชร์กับคู่หู                            | ใช่    | ใช่    |
| ระบบจดจำใบหน้าและการจัดกลุ่ม                | ใช่    | ใช่    |
| ความทรงจำ (x ปีที่แล้ว)                    | ใช่    | ใช่    |
| รองรับแบบออฟไลน์                           | ใช่    | ไม่ใช่ |
| แกลเลอรีแบบอ่านอย่างเดียว                  | ใช่    | ใช่    |
| ภาพถ่ายซ้อนกัน                             | ใช่    | ใช่    |

## การแปลภาษา

อ่านเพิ่มเติมเกี่ยวกับการแปล [ที่นี่](https://docs.opennoodle.de/developer/translations)
