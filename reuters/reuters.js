
import pt from 'puppeteer';
import mysql from 'mysql2/promise';
import { load } from 'cheerio';
import chalk from 'chalk';
import { del } from '@nodejscart/mysql-query-builder';

(async () => {
    const pool = mysql.createPool({
        "host":            "localhost",
        "user":            process.env.DB_ID,
        "password":        process.env.DB_PW,
        "database":        process.env.DB_SCHMA,
        "connectionLimit": 1
    })

    console.log(chalk.red.bold('[reuter crawler launch!]'))

    const brw = await pt.launch({headless: false})
    const pge = await brw.newPage()
    await pge.setViewport({
        height: 1920,
        width: 1080,
    })
    await performenceInitalize(pge)

    // const srcs = ['world', 'business', 'markets']
    await login(pge)
    await delay(5000)
    

    //world tap crwal
    console.log(chalk.green.bold('STARING WORLD TAB CRWAL'))
    const worldSubSrcs = await getAllSubCategory(pge, 'https://www.reuters.com/' + 'world')        
    for (const subSrc of worldSubSrcs) {
        try {
            await loadAllHiddenElement(pge, subSrc)
            const hrefs = await getNewsUrls(pge)
        }
        catch { 
            console.log(chalk.red.bold('WORLD exception logic execute'))
        }
    }   


    //business tap crwal
    console.log(chalk.green.bold('STARING BUSINESS TAB CRWAL'))
    const businessSubSrcs = await getAllSubCategory(pge, 'https://www.reuters.com/' + 'business')
    for (const subSrc of businessSubSrcs) {
        try {
            await loadAllHiddenElement(pge, subSrc)
            const hrefs = await getNewsUrls(pge)
        }
        catch {
            console.log(chalk.red.bold('BUSINESS exception logic execute'))
            await execute(pge)
        }
    }


})()

async function loadAllHiddenElement (pge, subSrc) {
    await pge.goto('https://www.reuters.com' + subSrc, {waitUntil: 'domcontentloaded'})

    for (let i=0; i<6; i++) {
        await pge.waitForSelector('div.content-layout__item__SC_GG > div > div > button')
        const loadBtnElement = await pge.$('div.content-layout__item__SC_GG > div > div > button')
        if (loadBtnElement) {
            await loadBtnElement.evaluate(loadBtnElement => loadBtnElement.focus(), loadBtnElement)
            await loadBtnElement.click()
        }
    }
}

async function getAllSubCategory (pge, url) {
    const result = new Array()
    await pge.goto(url, { waitUntil: 'domcontentloaded' })
    await pge.waitForSelector('div.section-selector__tablet-up__ZUl51 > ul')

    const subCategoryElements = await pge.$$('div.section-selector__tablet-up__ZUl51 > ul > li')
    for (const subEle of subCategoryElements) {
        const btnEle = await subEle.$('button')
        result.push(await btnEle.evaluate(btnEle => btnEle.getAttribute('data-id'), btnEle))
    }

    return result
}

async function login (pge) {
    await pge.goto('https://www.reuters.com/account/sign-in?redirect=https://www.reuters.com/news/archive/worldnNews?view=page&page=1&pageSize=10')
    await pge.type('#email', 'joyoungjun8590@gmail.com', {delay: 80})
    await pge.type('#password', '!Rnjsxkr534',           {delay: 80})
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
        const month = monthToNumberic(date.split(' ')[0])
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

function monthToNumberic (date) {
    const table = { January: '01', February: '02', March: '03', April: '04', May: '05', June: '06', July: '07', August: '08', September: '09', October: '10', November: '11', December: '12'}
    return table[date]
}

async function getNewsUrls (pge) {

    const exceptionUrls = ['israel-hamas', ]

    if (exceptionUrls.includes(getCurrentCategory(pge))) {
        await pge.waitForSelector("#main-content")
        return getNewsUrlsForException(pge)
    }

    return await pge.evaluate(() => {
        const result = new Array()
        const elements = document.querySelectorAll('div > .media-story-card__body__3tRWy > a')
        for (const ele of elements) {
            result.push(ele.getAttribute('href'))
        }
        return result
    })
}

function getCurrentCategory (pge) {
    return pge.url().replace('//', '').split('/')[2]
}

async function getNewsUrlsForException (pge) {
    return await pge.evaluate(() => {
        const result = new Set()
        const aElements = document.querySelectorAll('#main-content div.content-layout__item__SC_GG > div > ul > li > div > div > header > a')
        for (const aEle of aElements) {
            if (aEle.getAttribute('data-testid') === 'Link') {
                result.add(aEle.getAttribute('href'))
            }
        }
        return Array.from(result)
    })
}


async function performenceInitalize (pge) {
    await pge.setRequestInterception(true)
    pge.on('request', req => {
        // if (req.resourceType() === 'image' || req.resourceType() === 'font' || req.resourceType() === "stylesheet" || req.resourceType() === "media") {req.abort() }
        if (req.resourceType() === 'image' || req.resourceType() === 'font' || req.resourceType() === "media") {req.abort() }
        else {req.continue() }
    })
}


function delay (time) {
    return new Promise(function(resolve) { 
        setTimeout(resolve, time)
    });
 }

function urlBuilder (src, page) {
    return 'https://www.reuters.com/news/archive/' + src + '?view=page&page=' + page + '&pageSize=10'
}

async function crawlContent (pge, url) {
    await pge.goto('https://www.reuters.com'+url, {waitUntil: 'domcontentloaded'})
    const title   = await pge.$eval('header > div > div > h1', ele => ele.textContent)
    const date    = await pge.$eval('header > div > div > div > div.info-content__author-date__1Epi_ > time > span:nth-child(1)', ele => ele.textContent)
    const content = await pge.evaluate(() => {
        const texts = document.querySelectorAll('#main-content > article > div.article__main__33WV2 > div > div > div > div.article-body__content__17Yit > p')
        let result = ""

        for (const text of texts) {
            result += text.textContent
        }
        return result
    })

    return {title, date, content, url: pge.url()}
}

async function execute (pge) {
    const backupUrl = pge.url()

    Headline
    for (const latestStoryUrl of await getLatestStoriesSectionUrls(pge)) {
        console.log(await crawlContent(pge, latestStoryUrl))        
    }
    console.log('stories line done next wait')
    await delay(10000)
    await pge.goto(backupUrl, {waitUntil: 'domcontentloaded'})

    for (const topicHeaderUrl of await getTopicHeaderUrls(pge)) {
        await pge.goto('https://www.reuters.com' + topicHeaderUrl, {waitUntil: 'domcontentloaded'})

        for (const topicNewsUrl of await getTopicNewsUrls(pge)) {
            // const {title, content, date} = await crawlContent(pge, 'https://www.reuters.com' + topicNewsUrl)
            console.log(await crawlContent(pge, topicNewsUrl))
        }
    }
}

// // @deprecated
// async function getTopNewsSectionUrls (pge) {
//     await pge.waitForSelector('#main-content > div:nth-child(2) > div > div.content-layout__item__SC_GG > div')
//     return await pge.evaluate(() => {
//         const result = new Set()

//         const bigHeadeing = document.querySelector('div.content-layout__item__SC_GG > div > div > div.static-media-maximizer__hero__1-_RW > div > a')
//         result.add(bigHeadeing.getAttribute('href'))

//         const aElements = document.querySelectorAll('div.content-layout__item__SC_GG > div > ul > li')
//         for (const ele of aElements) {
//             result.add(ele.querySelector('div:nth-child(1)').getAttribute('href'))

//         }
//         return Array.from(result)
//     })
// }

// // @deprecated
// async function getTakingPointSectionUrls (pge) {
//     await pge.waitForSelector('ul.talking-points-v2__grid__T321l')
//     return await pge.evaluate(() => {
//         const result = new Array()
//         const aElements = document.querySelectorAll('ul.talking-points-v2__grid__T321l > li')

//         for (const ele of aElements) {
//             result.push(ele.querySelector('a').getAttribute('href'))
//         }

//         return result
//     })
// }

// @deprecated



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
        await delay(3000)
    }
    return result
}

async function getTopicHeaderUrls (pge) {
    const result = Array()
    const urls = await pge.$$('#main-content > div > div > h2 > a')
    for (const url of urls) {
        result.push(await pge.evaluate(url => url.getAttribute('href') , url))
    }
    return result
}

async function getTopicNewsUrls (pge) {
    const result = new Array()

    for (let i=0; i<3; i++) {
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
        await delay(4500)
    }

    return result
}
