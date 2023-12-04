
import pt from 'puppeteer';
import mysql from 'mysql2/promise';
import { load } from 'cheerio';
import chalk from 'chalk';
import 'dotenv'

(async () => {
    const pool = mysql.createPool({
        "host":            "localhost",
        "user":            process.env.DB_ID,
        "password":        process.env.DB_PW,
        "database":        process.env.DB_SCHMA,
        "connectionLimit": 5
    })

    console.log(chalk.red.bold('[reuters crawler launch!]'))

    const brw = await pt.launch({headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox']})
    const pge = await brw.newPage()
    const srcs = ['worldnNews', 'businessNews', 'marketNews']

    await login(pge)
    await delay(5000)
    
    let pagenation = 1
    for (const src of srcs) {
        while (true) {
            const url = urlBuilder(src, pagenation)
            console.log(chalk.green.bold('[urlBuilder] ') + url)
            if (await isEndPage(pge, url)) {
                console.log(chalk.magentaBright.bold('[PAGE END] ') + url)
                break
            }

            const news = await crawl(pge, url)

            const connection = await pool.getConnection(async conn => conn)
            for (let {category, title, content, date, link} of news) {
                category = category.split(' category')[0]
                    
                try {
                    if (title !== "" && content !== "") {
                        const sqlStatement = `INSERT INTO news (origin, title, content, category, url, created) VALUES (?, ?, ?, ?, ?, ?);`;
                        await connection.query(sqlStatement, ['reuters', title, content, category, link, date])
                    }
                }
                catch (err) { 
                    console.log(chalk.red.bold('!!! QUERY EXCEPTION !!!')) 
                    connection.release()
                }
            }

            connection.release()
            pagenation++
        }

        pagenation = 1
    }
})()


async function isEndPage (pge, url) {
    await pge.goto(url)
    const html = await pge.content()
    const $    = load(html)
    
    if ($('body > section > article > header > h2').text() === "Server Encountered an Error") {
        return true
    }
    return false
}


async function login (pge) {
    await pge.goto('https://www.reuters.com/account/sign-in?redirect=https://www.reuters.com/news/archive/worldnNews?view=page&page=1&pageSize=10')
    await pge.type('#email', '',    {delay: 80})    // 로이터 이메일
    await pge.type('#password', '', {delay: 80})    // 로이터 비밀번호
    await pge.click('.sign-in-form__sign-in-btn__2jvFh')
}


async function crawl (pge, url) {
    const news        = new Array()
    const articleUrls = await getNewsUrls(pge, url)

    for (const articleUrl of articleUrls) {
        console.log(chalk.white.gray.bold(articleUrl) + ' trying...')

        await pge.goto('https://www.reuters.com' + articleUrl, {timeout: 0})

        try {
            await pge.waitForSelector('.article-body__content__17Yit', {timeout: 30000})
        }
        catch (err) {
            console.log(chalk.white.red.bold(articleUrl) + ' pass crawl')
            continue    
        }

        const html = await pge.content()
        const $    = load(html)

        const category = $('#main-content > article > div.article__main__33WV2 > div > header > div > div > span > nav > ul > li > a').attr('aria-label')
        const title    = $('#main-content > article > div.article__main__33WV2 > div > header > div > div > h1').text()
        const contents = $('.article-body__content__17Yit > p')
        let   date     = $('#main-content > article > div.article__main__33WV2 > div > header > div > div > div > div.info-content__author-date__1Epi_ > time > span:nth-child(1)').text()
        
        date        = date.replace(',', '')
        const month = monthToNumeric(date.split(' ')[0])
        const day   = date.split(' ')[1]
        const year  = date.split(' ')[2]
        date        = year + '-' + month + '-' + day

        let content = ""
        for (const c of contents) { content += $(c).text() }

        news.push({title, content, date, category, link: pge.url()})
        console.log(chalk.white.gray.bold(articleUrl) + ' done')
        await delay(3000)
    }

    return news
}


function monthToNumeric (date) {
    const table = { January: '01', February: '02', March: '03', April: '04', May: '05', June: '06', July: '07', August: '08', September: '09', October: '10', November: '11', December: '12'}
    return table[date]
}


async function getNewsUrls (pge, url) {
    await pge.goto(url)
    await pge.waitForSelector('#content > section:nth-child(3) > div > div.column1.col.col-10 > section > section > div > article')
    
    const result   = new Array()
    const html     = await pge.content()
    const $        = load(html)
    const elements = $('#content > section:nth-child(3) > div > div.column1.col.col-10 > section > section > div > article')

    for (const ele of elements) {
        const href = $(ele).find('.story-content > a').attr('href')
        result.push(href)
    }

    return result
}


function delay (time) {
    return new Promise(function(resolve) { 
        setTimeout(resolve, time)
    });
 }


function urlBuilder (src, page) {
    return 'https://www.reuters.com/news/archive/' + src + '?view=page&page=' + page + '&pageSize=10'
}