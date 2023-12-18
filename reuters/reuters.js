
import mysql from 'mysql2/promise';
import chalk from 'chalk';
import { readFile } from 'fs/promises'
import 'dotenv/config'

const pool = mysql.createPool({
    "host":            process.env.DB_HOST,
    "port":            process.env.DB_PORT,
    "user":            process.env.DB_ID,
    "password":        process.env.DB_PW,
    "database":        process.env.DB_SCHMA,
    "connectionLimit": 1
})

let isRunning = false

export async function start (pge) {
    // 리눅스에서 ps -e 명령어 실행 시 보여질 프로세스 이름
    // 실행 가이드: nohup ./reuters/reuters.js &

    if (isRunning) { return }

    process.title = 'crwal-reuters'
    console.log(chalk.red.bold('[reuters crawler launch!]'))
    isRunning = true
    
    await performenceInitalize(pge)  // 시스템 자원 소모 최소화
    await byPassAnitBot(pge)         // 봇 인증 프로세스 우회 
    
    /*
        만약 봇 탐지가 발생한다면
        1) 브라우저를 키고 로이터에 접속 후 로그인
        2) 봇 탐지 프로세스를 진행 후 쿠키에 있는 내용을 전부 복사하여 bypass.json 내용을 덮어쓰기
        3) 크롤러 재실행

        만약 위 과정을 진행하려는데 차단되었습니다라는 문구가 뜰 경우
        1) 브라우저의 로이터 쿠키 데이터를 모두 삭제
    */

    await login(pge)                 // 로그인 진행

    try {
        await templateV2(pool, pge, 'world')
        await templateV2(pool, pge, 'business')
        await templateV2(pool, pge, 'markets')
    }
    catch(err) { console.log(err) }
    finally {
        isRunning = false
    }
}


async function templateV2 (pool, pge, category) {
    const connection = await pool.getConnection(async conn => conn) // DB 커넥션
    console.log(chalk.green.bold('STARING CRWAL TAB ' + category))

    for (const subSrc of await getAllSubCategory(pge, 'https://www.reuters.com/' + category)) { // 카테고리의 서브 카테고리 목록을 불러와 반복
        if (subSrc == "/world/reuters-next/") {
            break
        }

        try {
            console.log('current position=' + subSrc)
            await loadAllHiddenElement(pge, subSrc)     // 더 보기 버튼을 눌러서 추가적인 리스트를 불러옴
            await randomDelay() // BOT 차단 우회를 위한 8초 딜레이

            const hrefs = category === 'business' ? await getBusinessUrls(pge) : await getNewsUrls(pge) // 카테고리 별로 DOM 구조가 다름
            for (const href of hrefs) { // 뉴스 목록에서 실질적인 뉴스 URL을 가져옴
                await randomDelay()     // BOT 차단 우회를 위한 10초 딜레이

                console.log(chalk.yellow.bold(href + ' crwaling...'))
                const { title, date, content, url } = await crawlContent(pge, href)  // 뉴스의 타이틀, 본문, 작성일을 가져옴
                await insertQuery(connection, title, content, url, changeTimeFormatSring(date), subSrc) // DB에 데이터 삽입 (중복이 있으면 삽입 X)
                console.log(chalk.green.bold(href + ' successfuly!'))

                if (isOneWeekPassed(changeTimeFormatSring(date))) { // 현내 날짜로부터 일주일이 지났는지 확인
                    console.log(chalk.gray.bold('isOneWeekPassed=true'))
                    break   // 일주일이 지났다면 서브 카테고리 반복 중단
                }
            }
        }
        catch { // 비즈니즈 카테고리에서는 부분적으로 이 코드가 실행됨 (world, markets는 위의 코드가 실행) DOM 구조가 달라 다른 형태의 접근이 필요하기 때문
            const backupUrl = pge.url() 

            for (const latestStoryUrl of await getLatestStoriesSectionUrls(pge)) {
                const { title, date, content, url } = await crawlContent(pge, latestStoryUrl)
                await insertQuery(connection, title, content, url, changeTimeFormatSring(date), subSrc)

                if (isOneWeekPassed(changeTimeFormatSring(date))) {
                    console.log(chalk.gray.bold('isOneWeekPassed=true'))
                    break
                }
            }
    
            await randomDelay()
            await pge.goto(backupUrl, {waitUntil: 'domcontentloaded'}) 
        
            for (const topicHeaderUrl of await getTopicHeaderUrls(pge)) {
                await pge.goto('https://www.reuters.com' + topicHeaderUrl, {waitUntil: 'domcontentloaded'})
        
                for (const topicNewsUrl of await getTopicNewsUrls(pge)) {
                    await randomDelay()
                    const { title, date, content, url } = await crawlContent(pge, topicNewsUrl)
                    await insertQuery(connection, title, content, url, changeTimeFormatSring(date), subSrc)

                    if (isOneWeekPassed(changeTimeFormatSring(date))) {
                        console.log(chalk.gray.bold('isOneWeekPassed=true'))
                        break
                    }
                }
            }
        }
    }

    connection.release()
}

function isOneWeekPassed(targetDate) {
    const oneWeekInMilliseconds = 7 * 24 * 60 * 60 * 1000;
    const targetDateTime = new Date(targetDate).getTime();
    const currentDateTime = new Date().getTime();
    return (currentDateTime - targetDateTime) >= oneWeekInMilliseconds;
}

// DB에 URL이 있는지 없는지 확인
async function isExists (connection, url) {
    const sqlStatement = `SELECT COUNT(*) as CNT FROM news WHERE link='${url}';`;
    const result = await connection.query(sqlStatement)
    return result[0][0].CNT !== 0
}


// 로이터 캡차 우회
async function byPassAnitBot (pge) {
    const json = JSON.parse(await readFile(new URL('./bypass.json', import.meta.url)))
    await pge.setCookie(...json)
}


// 더 보기 버튼 클릭
async function loadAllHiddenElement (pge, subSrc) {
    await pge.goto('https://www.reuters.com' + subSrc, { waitUntil: 'domcontentloaded' })
    for (let i=0; i<15; i++) {
        try {
            await pge.waitForSelector('div.content-layout__item__SC_GG > div > div > button', {timeout: 60000})
            const loadBtnElement = await pge.$('div.content-layout__item__SC_GG > div > div > button')
            if (loadBtnElement) {
                await loadBtnElement.click()
            }
            await randomDelay()
        }
        catch {
            throw new Error('busniess')
        }
    }
}


// 카테고리의 보조 카테고리를 가져옴
async function getAllSubCategory (pge, url) {
    const result = new Array()
    await pge.goto(url, { waitUntil: 'domcontentloaded' })
    await pge.waitForSelector('#main-content > div:nth-child(1) > div > div > nav > div > ul', {timeout: 60000})

    const subCategoryElements = await pge.$$('div.section-selector__tablet-up__ZUl51 > ul > li')
    for (const subEle of subCategoryElements) {
        const btnEle = await subEle.$('button')
        const dataId = await btnEle.evaluate(btnEle => btnEle.getAttribute('data-id'))

        if (dataId !== '/world/year-in-review/') {
            result.push(dataId)
        }
    }
    return result
}


// 로그인
async function login (pge) {
    await pge.mouse.move(Math.random()  * 1000, Math.random() * 1000)
    await pge.mouse.click(Math.random() * 1000, Math.random() * 1000)
    // await pge.goto('https://www.reuters.com/account/sign-in?redirect=https%3A%2F%2Fwww.reuters.com%2Fbusiness%2Fenergy%2Foil-prices-regain-ground-after-falling-six-month-lows-2023-12-07%2F')
    // await pge.type('#email', 'joyoungjun8590@gmail.com', {delay: 100})
    // await pge.type('#password', '!Rnjsxkr534',           {delay: 100})
    // await pge.click('.sign-in-form__sign-in-btn__2jvFh')
    await pge.goto('https://www.reuters.com', {waitUntil: 'domcontentloaded'})
    // await pge.evaluate(() => {
    //     localStorage.setItem('ArcId.USER_INFO', {"uuid":"62c9e04e-1865-4c65-8e0a-4393cd78c2cf","accessToken":"eyJhbGciOiJIUzUxMiJ9.eyJ1dWlkIjoiNjJjOWUwNGUtMTg2NS00YzY1LThlMGEtNDM5M2NkNzhjMmNmIiwidW4iOiJqb3lvdW5nanVuODU5MEBnbWFpbC5jb20iLCJkYXRlIjoiMTcwMjM0MTY5NjgyNSIsImlhdCI6MTcwMjM0MTY5NiwiZXhwIjoxNzAyMzQyNTk2LCJqdGkiOiJiNzQ1NjQxYi00ZTE3LTRmNjctYWFiMy1kYzQyZTRkNmUyNGUifQ.C_ucPWhAAGMtzRgSUI_hs6IACjPcJFK439acMuIcmPNX6Ae9zai176yLeSz-qrKWh7z9Il6u4DD8z3-STiGsmw","refreshToken":"eyJhbGciOiJIUzUxMiJ9.eyJ1dWlkIjoiNjJjOWUwNGUtMTg2NS00YzY1LThlMGEtNDM5M2NkNzhjMmNmIiwidW4iOiJqb3lvdW5nanVuODU5MEBnbWFpbC5jb20iLCJkYXRlIjoiMTcwMjM0MTY5NjgyNSIsImlhdCI6MTcwMjM0MTY5NiwiZXhwIjoxNzMzODk5Mjk2LCJqdGkiOiJlZjc1MTFkMy05NzBjLTQ0OGMtODNmMS0xOGY4ODU2NTZlMmYiLCJwanRpIjoiYjc0NTY0MWItNGUxNy00ZjY3LWFhYjMtZGM0MmU0ZDZlMjRlIn0.g55DdFoYsgkG1V6Ma_W2LBkk7KCXVx9axDbwgfLSGchTiWTzmM330sIj3vfLn2ln3MFsrwsEclo1eN75XQrwPA"})
    //     localStorage.setItem('ArcId.USER_PROFILE', {"createdOn":1701060193000,"modifiedOn":1701060272000,"deletedOn":null,"firstName":"Jo","lastName":"young jun","secondLastName":null,"displayName":null,"gender":null,"email":"joyoungjun8590@gmail.com","unverifiedEmail":null,"picture":null,"birthYear":null,"birthMonth":null,"birthDay":null,"emailVerified":true,"contacts":null,"addresses":null,"attributes":[{"name":"Country","value":"Korea, Republic of","type":"String"},{"name":"T&C Acceptance","value":"true","type":"Boolean"},{"name":"Geolocation","value":"kr","type":"String"},{"name":"Announcements & Offers","value":"true","type":"Boolean"},{"name":"Subscription Plan","value":"FREE","type":"String"},{"name":"Sign-up reCAPTCHA Score","value":"0.30000001192092896","type":"String"},{"name":"Industry","value":"Technology","type":"String"},{"name":"Job Role/Job Area","value":"Data, Analytics and AI","type":"String"},{"name":"Job level","value":"CXO / Exec / Senior Management","type":"String"},{"name":"Technology Roundup","value":"true","type":"Boolean"},{"name":"Reuters Crypto","value":"true","type":"Boolean"},{"name":"Newsletter Subscription","value":"true","type":"Boolean"},{"name":"Preferred Section","value":"Technology","type":"String"},{"name":"onboardingOfferedCount","value":"1","type":"String"},{"name":"sailthru-uuid","value":"65641ea37a2a88cb1f085054","type":"String"}],"identities":[{"userName":"joyoungjun8590@gmail.com","passwordReset":false,"type":"Password","lastLoginDate":1702341697000,"locked":false,"oidc":false}],"legacyId":null,"status":"Active","deletionRule":null,"uuid":"62c9e04e-1865-4c65-8e0a-4393cd78c2cf"})
    //     localStorage.setItem('rt_token', 'eyJraWQiOiI4YTU2YmFmYy1iNzBmLTRhM2MtYjAwYS00Y2FiZDZhNmYwMDUiLCJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJvYXV0aC1jbGllbnQiLCJhdWQiOiJvYXV0aC1jbGllbnQiLCJuYmYiOjE3MDIzNDI2NDAsInN1YnMiOltdLCJwcm9maWxlX2lkIjoiNjJjOWUwNGUtMTg2NS00YzY1LThlMGEtNDM5M2NkNzhjMmNmIiwiaXNzIjoiaHR0cHM6Ly9jdXN0b20tcmVzb2x2ZXItaW50ZXJuYWwucHJvZC5nbG9iYWwuYTIwMTgzNi5yZXV0ZXJzbWVkaWEubmV0IiwiZXhwIjoxNzAyMzQzNTM4LCJpYXQiOjE3MDIzNDI2NDB9.ghrmxlYT1FrCIlkdkIbsVO_stJcxA-Rob3kbDWyuR-CT66zAc0hLeCaZOFlO-ButsHksnjqdfLqtHJpcy9PmovPX9sRYS_IakLuUOFb_rMcP93epp-oH5ucfSQz050L6XVFdbErngkR18QaSEp7nfsMt62ETM7Sbi3FCMxaOsMwz89ozjxumz_agzsYMijfrjlaC-mSo4ZMlqcqYVuktOAAn4uHWg0flfYRCx1yT3OQqkcwegcVAHuFU945P593h4IL4R3P5rVSAPpXrYqJMgXjTYWXLlvcQIUVrip-UOuNGH8qkMsRVM3_dQ9ZL-kpmUqVWsU3ONkWB0WkpuU5iKA')
    // })
    await randomDelay()            // 로그인 후 어느정도의 딜레이를 주지 않으면 반영이 되질 않음 그러기에 5초간 딜레이
}


// 파싱한 문자 형태의 시간 데이터를 01 02 03 04 . . . 로 바꿈
function monthToNumeric (date) {
    const table = { January: '01', February: '02', March: '03', April: '04', May: '05', June: '06', July: '07', August: '08', September: '09', October: '10', November: '11', December: '12'}
    return table[date]
}


// 비즈니스 카테고리의 페이지 뉴스들의 링크들을 가져옴
async function getBusinessUrls (pge) {
    await pge.waitForSelector('div.content-layout__item__SC_GG > div > ul')
    return pge.evaluate(() => {
        const result = new Array()
        const lists = document.querySelectorAll('div.content-layout__item__SC_GG > div > ul > li')

        for (const item of lists) {
            const type = item.querySelector('div').getAttribute('data-testid')
            if (type === "TextStoryCard") {
                const element = item.querySelector('div > a')
                if (element) {
                    result.push(item.querySelector('div > a').getAttribute('href'))
                }
            }
            else {
                const element = item.querySelector('div > .media-story-card__placement-container__1R55- > a')
                if (element) {
                    result.push(item.querySelector('div > .media-story-card__placement-container__1R55- > a').getAttribute('href'))
                }
            }
        }
        return result
    })
} 


// 월드, 마켓 카테고리 페이지 뉴스들의 링크들을 가져옴
async function getNewsUrls (pge ) {
    await pge.waitForSelector('div.content-layout__item__SC_GG > div > ul > li')

    return await pge.evaluate(() => {
        const result = new Array()
        const elements = document.querySelectorAll('div.content-layout__item__SC_GG > div > ul > li')

        for (const ele of elements) {
            const type = ele.querySelector('div').getAttribute('data-testid')
            if (type === "TextStoryCard") {
                result.push(ele.querySelector('div > a').getAttribute('href'))
            }
            if (type === "MediaStoryCard") { 
                result.push(ele.querySelector('a').getAttribute('href'))
            }
        }
        return result
    })
}``


// 성능 최적화를 위함
async function performenceInitalize (pge) {
    await pge.setRequestInterception(true)
    pge.on('request', req => {
        if (req.resourceType() === 'image' || req.resourceType() === 'font' || req.resourceType() === "media" || req.resourceType() === "stylesheet") {req.abort() }
        else {req.continue() }
    })
}


// 파싱한 작성일을 0000-00-00 형태의 문자열로 변환
function changeTimeFormatSring (date) {
    date        = date.replace(',', '')
    const month = monthToNumeric(date.split(' ')[0])
    let day   = date.split(' ')[1]
    day = day.length === 1 ? "0" + day : day
    const year  = date.split(' ')[2]
    return year + '-' + month + '-' + day
}


// 딜레이
function delay (time) {
    return new Promise(function(resolve) { 
        setTimeout(resolve, time)
    });
}

async function randomDelay() {
    // 8초에서 15초 사이의 랜덤 딜레이를 계산
    const minDelay = 10000; // 10초
    const maxDelay = 20000; // 20초
    const d = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
  
    // 딜레이
    await delay(d);
}

// 뉴스의 타이틀, 본문, 작성일을 긁어오는 핵심
async function crawlContent (pge, url) {
    let title   = null
    let date    = null 
    let content = null

    try {
        await pge.goto('https://www.reuters.com' + url, { waitUntil: 'domcontentloaded' })
        title   = await pge.$eval('header > div > div > h1', ele => ele.textContent)
        date    = await pge.$eval('header > div > div > div > div.info-content__author-date__1Epi_ > time > span:nth-child(1)', ele => ele.textContent)
        content = await pge.evaluate(() => {
            const texts = document.querySelectorAll('#main-content > article > div.article__main__33WV2 > div > div > div > div.article-body__content__17Yit > p')
            let result = ""
            for (const text of texts) { result += text.textContent }
            return result
        })
    }
    catch {
        title   = await pge.$eval('div.article__main__33WV2 > div > header > div > div > h1')
        date    = await pge.$eval('div.info-content__author-date__1Epi_ > time > span:nth-child(1)')
        content = await pge.evaluate(() => {
            const texts = document.querySelectorAll('#main-content > article > div.article__main__33WV2 > div > div > div > div > p')
            let result = ""
            for (const text of texts) { result += text.textContent }
            return result
        }) 
    }

    return {title, date, content, url: pge.url()}
}


// DB에 값 삽입 (중복 시 삽입 X)
async function insertQuery (connection, title, body, url, date, category) {
    if (!(await isExists(connection, url))) {
        const sqlStatement = `INSERT INTO news (origin, title, body, source, link, date_str) VALUES (?, ?, ?, ?, ?, ?);`;
        await connection.query(sqlStatement, ['reuters', title, body, category, url, date])
    }
    else {
        console.log(chalk.gray.bold('duplicate data pass'))
    }
}


// 비즈니스 카테고리 페이지 크롤링을 위함
async function getLatestStoriesSectionUrls (pge) {      
    const navs = await pge.$$('.section-selector-tabs__selector-tab-list__2b75- > div')
    const result = new Array()

    await pge.waitForSelector('#carousel-container > li')
    for (const nav of navs) {
        const urls = await pge.evaluate(() => {
            const result = new Array()
            const items = document.querySelectorAll('#carousel-container > li')
            for (const item of items) {
                result.push(item.querySelector('div > div').getAttribute('href'))
            }
            return result
        })
        result.push(...urls)
        await nav.click()
        await randomDelay()
    }
    return result
}


// 비즈니스 카테고리 페이지 크롤링을 위함
async function getTopicHeaderUrls (pge) {
    const result = Array()
    const urls = await pge.$$('#main-content > div > div > h2 > a')
    for (const url of urls) {
        result.push(await pge.evaluate(url => url.getAttribute('href') , url))
    }
    return result
}


// 비즈니스 카테고리 페이지 크롤링을 위함
async function getTopicNewsUrls (pge) {
    const result = new Array()

    for (let i=0; i<6; i++) {
        const urls = await pge.evaluate(() => {
            const result = new Array()
            const elements = document.querySelectorAll('div.search-results__sectionContainer__34n_c > ul > li > div')
            for (const element of elements) {
                if (element.getAttribute('data-testid') === "MediaStoryCard") {
                    result.push(element.querySelector('div:nth-child(2) > a').getAttribute('href'))
                }
                else {
                    result.push(element.querySelector('div > a').getAttribute('href'))
                }
            }
            return result
        })
        
        result.push(...urls)
        const nextBtnElement = await pge.$('div.search-results__pagination__2h60k > button:nth-child(3)')
        await nextBtnElement.click()
        await randomDelay()
    }

    return result
}
