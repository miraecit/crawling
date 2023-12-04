
import puppeteer  from 'puppeteer';
import mysql      from 'mysql2/promise';
import { load }   from 'cheerio';
import chalk from 'chalk';
import 'dotenv'

(async () => {
    const pool = mysql.createPool({
        "host":            "localhost",
        "user":            process.env.DB_ID,
        "password":        process.env.DB_PW,
        "database":        process.env.DB_SCHMA,
        "connectionLimit": 1
    })
    
    const brw = await puppeteer.launch({headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox']})
    const pge  = await brw.newPage()
    const srcs = ['copper', 'gold', 'lithium', 'nickel', 'silver']

    for (const src of srcs) {
        let pagenation = 1 

        while (true) {
            const url = pagenation === 1 ? 
                'https://www.mining.com/commodity/' + src + '/' : 
                'https://www.mining.com/commodity/' + src + '/page/' + pagenation + '/#latest-section'
            
            console.log(chalk.yellow.bold(url + ' crawling...'))

            await pge.goto(url)
    
            const html = await pge.content()
            const $    = load(html)
            const news = $('#latest-section')
    
            // section .error-404 not-found 페이지가 없을 때
            if ($('.error-404').find().length !== 0) {
                console.log('END')
                break
            }   
            
            // 미리보기
            for (const element of $(news).find('div > div > article > div > h3')) {
                const title = $(element).find('a')
                const href = title.attr('href')
                
                const { content, created, url } = await crawlArticle(href)
                const connection = await pool.getConnection(async conn => conn)
    
                try {
                    if (title !== "" && content !== "") {
                        const sqlStatement = `INSERT INTO news (origin, title, content, category, url, created) VALUES (?, ?, ?, ?, ?, ?);`;
                        await connection.query(sqlStatement, ['mining', title.text(), content, 'copper', url, created])
                    }
                }
                catch (err) { 
                    console.log('DB EXCEPTION=' + err) 
                }
    
                finally { connection.release() }
                await delay(10000)
            }
            
            pagenation++
        }
    }

    await pge.close()
    await brw.close()
})();

async function crawlArticle (url) {
    const page = await brw.newPage()
    await page.goto(url)
    const html = await page.content()
    const $    = load(html)
    let result = {
        content: '',
        created: '',
        url: page.url()
    }

    const created = $('#single-post > div.site-content.single > div > div > div.post-meta.mb-4').text()
    let contents  = $('#single-post > div.site-content.single > div > div > div.post-inner-content.row > div.col-lg-8.order-0 > p')

    result.created = changeTimeFormatString(created)

    for (const element of contents) {
        result.content += $(element).text()
    }

    contents = $('body > div > div > div.post-inner-content.row > div.col-lg-8.order-0 > p')
    for (const element of contents) {
        result.content += $(element).text()
    }               
    
    page.close()
    return result
}

function changeTimeFormatString (time) {
    try {
        const split = time.split(' | ')
        const a = split[1].replace(',', '')
        const b = a.split(' ')
        const table = { January: '01', February: '02', March: '03', Aprill: '04', May: '05', June: '06', July: '07', August: '08', September: '09', October: '10', November: '11', December: '12'}
        return b[2] + '-' + table[b[0]] + '-' + b[1]
    }
    catch (err) {
        return time
    }
}

function delay (time) {
    return new Promise(function(resolve) { 
        setTimeout(resolve, time)
    });
}
