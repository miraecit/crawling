# Crawl

구글에서 개발한 **puppeteer** 를 사용하여 뉴스 매체인 **Guardian**, **Reuters**, **Mining**, **Wall street journal** 의 내용을 크롤링 할 수 있는 학습용 예제 소스입니다.


# Setup
***실행환경***
- NodeJS v18 이상
- MariaDB
<br/>

***MariaDB SQL***

    CREATE  TABLE  IF  NOT  EXISTS  `news` (
	    `id`  bigint(20) NOT NULL AUTO_INCREMENT,
	    `origin`  varchar(100) DEFAULT  NULL,
	    `title`  varchar(800) DEFAULT  NULL,
	    `content` longtext DEFAULT  NULL,
	    `category`  varchar(100) DEFAULT  NULL,
	    `url`  varchar(500) DEFAULT  NULL,
	    `created`  varchar(100) DEFAULT  NULL,
	    PRIMARY KEY (`id`)
    )




<br/>

***Source 수정 필요***

    const  pool  =  mysql.createPool({
        "host":  "localhost",
        "user":  "데이터베이스 아이디",
        "password":  "데이터베이스 비밀번호",
        "database":  "데이터베이스",
        "connectionLimit":  5 // 커넥션 개수
    });

## Execute

    # npm i 
    # node ./{mining|guardian|reuters}/{mining|guardian|reuters|}.js   

1) 필요한 의존성 모듈을 설치합니다.
2) 해당되는 매체의 데이터를 크롤링합니다.

