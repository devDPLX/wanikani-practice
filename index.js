const nodeFetch = require('node-fetch');
const romaji = require('romaji');
const readline = require('readline');
const { wkKey } = require('./config.json');
//
const newRL = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});
//
function getAllPages(url, key, continuation = []) {
  return new Promise((resolve, reject) => {
    nodeFetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${key}`
      }
    }).then(res => res.json()).then(json => {
      let pages = json.pages;
      if (!pages) {
        resolve(json);
      }
      for (let data of json.data) {
        continuation.push(data)
      }
      let nextURL = pages.next_url;
      if (nextURL == null) {
        resolve(continuation);
        return;
      }
      getAllPages(nextURL, key, continuation).then(result => {
        resolve(result);
      })
    }).catch(error => {
      reject(error);
    }).catch(error => {
      reject(error);
    });
  });
}

function getTestableReviews(wkKey,filterString) {
  return new Promise((resolve, reject) => {
    console.log('Loading pages...');
    getAllPages(`https://api.wanikani.com/v2/subjects${filterString}`, wkKey).then(subjectResults => {
      if (subjectResults.error) {
        reject(`Error ${subjectResults.code}: ${subjectResults.error}`);
      }
      console.log(subjectResults.length.toString(), 'results found.');
      console.log('Comparing with available reviews...');
      getAllPages('https://api.wanikani.com/v2/reviews', wkKey).then(reviewResults => {
        if (reviewResults.error) {
          reject(`Error ${reviewResults.code}: ${reviewResults.error}`);
        }
        let subjects = subjectResults.filter(sResult => {
          let validResults = reviewResults.find(rResult => {
            return rResult.data.subject_id == sResult.id && sResult.data.characters;
          });
          return validResults;
        });
        console.log(subjects.length.toString(), 'testable reviews found.');
        resolve(subjects);
      }).catch(error => {
        reject(error);
      });
    }).catch(error => {
      reject(error);
    });
  });
}

function getUserInfo() {
  return new Promise((resolve,reject) => {
    nodeFetch('https://api.wanikani.com/v2/user',{
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${wkKey}`
      }
    }).then(res => res.json()).then(json => {
      if (json.error) {
        reject(`Error ${json.code}: ${json.error}`);
        return;
      }
      resolve({
        username: json.data.username,
        level: json.data.level
      });
    }).catch(error => {
      reject(error);
    }).catch(error => {
      reject(error);
    });
  });
}

function getAnswer(review) {
  return new Promise((resolve, reject) => {
    let object = review.object;
    let characters = review.data.characters;
    let meanings = review.data.meanings;
    let validMeanings = meanings.filter(meaning => meaning.accepted_answer);
    let auxMeanings = review.data.auxiliary_meanings;
    newRL.question(`What is the meaning of the ${object}: ${characters}?\n`, function(response) {
      if (response == 'stop!') resolve(undefined);
      if (validMeanings.find(meaning => meaning.meaning.toLowerCase() == response.toLowerCase()) ||
            auxMeanings.find(meaning => meaning.meaning.toLowerCase() == response.toLowerCase())) {
        console.log('Correct!');
        if (object == 'radical') {
          resolve(true);
          return;
        }
        let readings = review.data.readings;
        let validReadings = readings.filter(reading => reading.accepted_answer);
        newRL.question(`What is the reading of the ${object}: ${characters}?\n`, function(secondResponse) {
          if (secondResponse == 'stop!') resolve(undefined);
          if (validReadings.find(reading => romaji.fromKana(reading.reading) == secondResponse)) {
            console.log('Correct!');
            resolve(true);
          } else {
            console.log('Incorrect.');
            let readingsArray = validReadings.map(reading => reading.reading);
            for (let reading in readingsArray) {
              readingsArray[reading] += ` (${romaji.fromKana(readingsArray[reading])})`;
            }
            let answersString = readingsArray.join(', ');
            let isMultiple = readingsArray.length > 1;
            console.log(`The correct reading${isMultiple ? 's': ''} for ${characters} ${isMultiple ? 'are' : 'is'}: ${answersString}.`);
            resolve(false);
          }
        });
      } else {
        console.log('Incorrect.');
        let meaningsArray = validMeanings.map(meaning => meaning.meaning);
        let auxArray = auxMeanings.map(meaning => meaning.meaning);
        let combinedArray = meaningsArray.concat(auxArray);
        let answersString = combinedArray.join(', ');
        let isMultiple = combinedArray.length > 1;
        console.log(`The correct meaning${isMultiple ? 's': ''} for ${characters} ${isMultiple ? 'are' : 'is'}: ${answersString}.`);
        resolve(false);
      }
    });
  });
}

async function testReviews(reviews) {
  let review = reviews[Math.floor(Math.random() * reviews.length)];
  /*if (review.data.slug !== 'hat') {
    testReviews(reviews);
    return;
  }*/
  let response = await getAnswer(review);
  if (response !== undefined) {
    console.log('\n');
    testReviews(reviews);
  } else {
    newRL.close();
  }
}

function getLevel(maxLevel) {
  return new Promise((resolve,reject) => {
    newRL.question('What level would you like to test? You can say \'all\' or just leave it blank for all levels.\n', function(levelResponse) {
      if (levelResponse == 'all' || levelResponse == '') {
        resolve('all');
        return;
      }
      let level = parseInt(levelResponse);
      if (!level) {
        console.log('You didn\'t enter a number.');
        return resolve(getLevel(maxLevel));
      }
      if (level > maxLevel) {
        console.log('You haven\'t reached that level yet!');
        return resolve(getLevel(maxLevel));
      }
      resolve(level);
    });
  })
}

function getCategory() {
  return new Promise((resolve,reject) => {
    newRL.question('What category would you like to test? Valid options are: radical, kanji, vocabulary, all, or just leaving it blank.\n', function(category) {
      switch (category) {
        case 'radical' : case 'kanji': case 'vocabulary': case 'all': resolve(category); break;
        case '': resolve('all'); break;
        default:
          console.log('That wasn\'t a valid entry.');
          return resolve(getCategory());
      }
    });
  });
}

async function start() {
  let userInfo = await getUserInfo();
  console.log(`Hello, ${userInfo.username}!`);
  let maxLevel = userInfo.level;
  let level = await getLevel(maxLevel);
  let category = await getCategory();
  let filterString = `${level !== 'all' || category !== 'all' ? `?${level !== 'all' ? `levels=${level}` : ''}${level !== 'all' && category !== 'all' ? '&' : ''}${category !== 'all' ? `types=${category}` : ''}` : ''}`;
  getTestableReviews(wkKey,filterString).then(result => {
    testReviews(result);
  }).catch(error => {
    console.log(error);
    newRL.close();
  });
  //
}

start();