
import puppeteer from 'puppeteer';
import mysql from 'mysql2/promise';
import { load } from 'cheerio';

const pool = mysql.createPool({
    "host":            "localhost",
    "user":            "",          // 데이터베이스 아이디
    "password":        "",          // 데이터베이스 비밀번호
    "database":        "",         // 데이터베이스
    "connectionLimit": 5                
})


(async () => {
    const brw = await puppeteer.launch({headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox']})
    const pge = await brw.newPage()

    let pagenation = 1
    // US, UK, EUROPE, MIDDLE, AUS, AMERICA, PACIFIC
    const urls = ['https://www.theguardian.com/us-news?page=',      'https://www.theguardian.com/uk-news?page=', 'https://www.theguardian.com/world/europe-news?page=',
        'https://www.theguardian.com/world/middleeast?page=',   'https://www.theguardian.com/australia-news?page=', 'https://www.theguardian.com/world/americas?page=',
        'https://www.theguardian.com/world/asia-pacific?page=', 'https://www.theguardian.com/world/africa?page=']

    for (const url of urls) {
        await pge.goto(url + pagenation)
        while (pge.url !== url.split('?')[0]) {
            console.log(pge.url() + ' !== ' + url.split('?')[0])
            const html = await pge.content()
            const $    = load(html)
            const news = $('.u-cf > .fc-container')
    
            for (const section of news) {
                const created   = $(section).find('div > header > a > time').text().replace("'", '')
                const urls      = $(section).find('.js-headline-text')
                
                for (const url of urls) {
                    const href = $(url).attr('href')
                    if (href !== undefined) {
                        const {title, content, url, category} = await crawlArticle(href)
                        const connection = await pool.getConnection(async conn => conn)
    
                        try {
                            if (title !== "" && content !== "") {
                                const sqlStatement = `INSERT INTO news (origin, title, content, category, url, created) VALUES (?, ?, ?, ?, ?, ?);`;
                                await connection.query(sqlStatement, ['guardian', title, content, category, url, changeTimeFormatSring(created)])
                            }
                        }
                        catch (err) { console.log('ERROR') }
                        finally { connection.release() }
                    }
                } 
            }
    
            pagenation++
            await pge.goto(url+pagenation)
        }        

        pagenation = 1
    }

    brw.close()

    // 새 탭을 생성하고 url에 접속하여 크롤링 실행
    async function crawlArticle (url) {
        const articlePage = await brw.newPage()
        await articlePage.goto(url)

        await delay(2000)
        
        try {
            await articlePage.waitForSelector('body > main > article', { visible: true, timeout: 3000 })
        }
        catch (err) { 
            articlePage.close()
            return {title: "", content: "", url: ""} 
        } 

        const html        = await articlePage.content()
        const $           = load(html)
        
        const area       = $('body > main > article')
        const title      = $(area).find('.dcr-1msbrj1 > h1').text()
        const categories = $('#bannerandheader > aside > div > gu-island > div > ul > li')
        let category     = null 

        if (title === null) {
            return { title: null, article: null, category }
        }

        for (const element of categories) {
            const isChecked = $(element).find('a > span')
            if ($(isChecked).length !== 0) {
                category = $(isChecked).text()
                break
            }
        }

        if (category == null) {
            const parse = articlePage.url().replace('//', '').split('/')[1].split('?')[0]            
            category = parse === 'uk-news' ? 'UK' : parse
            category = parse === 'us-news' ? 'US' : capitalizeFirstLetter(parse)
        }

        const maincontent  = $(area).find('#maincontent')
        let articleObject = {
            title,
            content: '',
            url: articlePage.url(),
            category
        }


        //i'll do it later 가 있는지 확인하고 있다면 클릭해서 숨겨진 본문 노출시키기
        if ($('#maincontent').find('#dcr-pvn4wq').length != 0)  {
            console.log("i'll do it later CLICK")
            await articlePage.click('#sign-in-gate-main_dismiss')
        }

        if (await articlePage.$('.article-body-commercial-selector > ul:nth-child(1)') !== null) {
            //li 형식
            for (const item of $(maincontent).find('ul li')) {
                const text = $(item).find('p').text()
                if (text != undefined) {
                    articleObject.content += text + ' '
                }
            }
        }
        else { // 본문형식
            const textElements = $(maincontent).find('.dcr-1kas69x')
            for (const textElement of textElements) {
                const text = $(textElement).text()
                if (text != undefined) {
                    articleObject.content += text + ' '
                }
            }
        }

        articlePage.close()
        return articleObject
    }   
})();

function changeTimeFormatSring (time) {
    const split = time.split(' ')
    const table = { January: '01', February: '02', March: '03', April: '04', May: '05', June: '06', July: '07', August: '08', September: '09', October: '10', November: '11', December: '12'}
    const day = split[0].length == 1 ? '0' + split[0] : split[0]
    return split[2] + '-' + table[split[1]] + '-' + day
}

function delay (time) {
    return new Promise(function(resolve) { 
        setTimeout(resolve, time)
    });
}

function capitalizeFirstLetter(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}
