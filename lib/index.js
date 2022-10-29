// Native
const fs = require('fs')
const crypto = require('crypto')

// Packages
const request = require('request-promise-native')
const { Cookie } = require('tough-cookie')
const isUrl = require('is-url')
const useragentFromSeed = require('useragent-from-seed')
const tough = require('tough-cookie');

const baseUrl = 'https://instagram.com/'
const baseUrlApi = 'https://i.instagram.com/api/v1'


const userAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 15_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 244.0.0.12.112 (iPhone12,1; iOS 15_5; en_US; en-US; scale=2.00; 828x1792; 383361019)"

//insert your session id here
const sessionid = "55978339344%3Aeb7qVzqRdnbvzF%3A0%3AAYeHuAws1hIv4M28L9a0ryvZClLLK_4537IP9BShEw";


class Instagram {
  constructor(
    { username, password, cookieStore },
    { language, proxy, requestOptions } = {}
  ) {
    this.credentials = {
      username,
      password
    }

    const jar = request.jar(cookieStore)
    jar.setCookie(request.cookie('ig_cb=1'), baseUrl)
    const { value: csrftoken } =
      jar.getCookies(baseUrl).find(({ key }) => key === 'csrftoken') || {}


    /*
    const userAgent = useragentFromSeed(username)
    if (requestOptions === undefined) {
      requestOptions = {}
    }
    */

    if (requestOptions === undefined) {
      requestOptions = {}
    }

    requestOptions.baseUrl = baseUrl
    requestOptions.uri = ''
    requestOptions.headers = {
      'User-Agent': userAgent,
      'Content-Type': "application/x-www-form-urlencoded",
      'Accept-Language': language || 'en-US',
      'Accept': '*/*',
      'X-CSRFToken': csrftoken,
      'X-Requested-With': 'XMLHttpRequest',
      'X-ASBD-ID': 198387, //consts from instagram web app
      'X-IG-App-ID': 936619743392459,
      Referer: "https://www.instagram.com/",
      Origin: "https://www.instagram.com",
      "X-IG-WWW-Claim": 0,
      "Connection": "keep-alive", //probably don't need these but it's probably good to be as realistic as possible
      "Access-Control-Request-Headers": "x-asbd-id,x-ig-app-id,x-ig-www-claim,x-instagram-ajax",
      "Access-Control-Request-Method": "GET",
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-site",
      "TE": "trailers"
    }
    requestOptions.proxy = proxy

    requestOptions.jar = jar
    requestOptions.json = true
    this.request = request.defaults(requestOptions)
    this.request = request.defaults({ baseUrl: baseUrl, headers: requestOptions.headers }) //not sure why but headers weren't getting set without this line, which may invalidate the previous line and proxy
  }

  async login({ username, password } = {}, { _sharedData = true } = {}) {
    username = username || this.credentials.username
    password = password || this.credentials.password

    // Get CSRFToken from cookie before login
    let value;
    await this.request('/', { resolveWithFullResponse: true, baseUrl: baseUrl }).then(res => {
      const pattern = new RegExp(/(csrf_token\\":\\")[\w]+/)
      const matches = res.body.match(pattern)
      value = matches[0].substring(15)

      //console.log("initial response headers: " + JSON.stringify(res.headers));

    });

    //csrftoken must be present in all requests, add using cookiejar.setCookie
    let cookie = new tough.Cookie({
        key: "csrftoken",
        value: value,
        domain: 'instagram.com',
        httpOnly: false,
        maxAge: 31536000
    });
    var cookiejar = request.jar();
    this.cookiejar = cookiejar; //save for later
    cookiejar.setCookie(cookie.toString(), 'https://instagram.com');

    //get landing page where ig_did and mid are present in the response headers
    let ig_did, mid;
    await this.request('/public/landing_info/', { 
      resolveWithFullResponse: true, 
      baseUrl: baseUrlApi
    }).then(res => {

      let cookies = res.headers["set-cookie"].map(Cookie.parse);
      
      ig_did = cookies.find(({ key }) => key === 'ig_did').toJSON();
      mid = cookies.find(({ key }) => key === 'mid').toJSON();

    });

    //not sure if we need these but they were present in the web requests on instagram.com
    cookiejar.setCookie("ig_did", new tough.Cookie(ig_did));
    cookiejar.setCookie("mid", new tough.Cookie(mid));


    // Provide CSRFToken for login or challenge request
    this.request = this.request.defaults({
      headers: { 'X-CSRFToken': value },
      jar: cookiejar
    })
    


    // Temporary work around for https://github.com/jlobos/instagram-web-api/issues/118
    const createEncPassword = pwd => {
      return `#PWD_INSTAGRAM_BROWSER:0:${Date.now()}:${pwd}`
    }

    // Login
    const res = await this.request.post('/web/accounts/login/ajax/', {
      resolveWithFullResponse: true,
      form: { 'username': username, enc_password: createEncPassword(password) },
      baseUrl: baseUrlApi
    })

    if (!res.headers['set-cookie']) {
      throw new Error('No cookie')
    }
    const cookies = res.headers['set-cookie'].map(Cookie.parse)
      

    // Get CSRFToken after successful login
    const { value: csrftoken } = cookies
      .find(({ key }) => key === 'csrftoken')
      .toJSON()

    let sessionid = new tough.Cookie({
        key: "sessionid",
        value: getNewSessionId().replaceAll("%3A", ":"), //replace the html url equavalent %3A with : if present
        domain: 'instagram.com',
        httpOnly: false,
        maxAge: 31536000
    });

    cookiejar.setCookie(sessionid.toString(), "https://instagram.com"); //add sessionid to cookies

    // Provide CSRFToken to request
    this.request = this.request.defaults({
      headers: { 
        'X-CSRFToken': csrftoken
      },
    })

    this.credentials = {
      username,
      password,
      // Add cookies to credentials
      cookies: cookies.map(cookie => cookie.toJSON())
    }


    return res.body
  }

  async logout() {
    return this.request('/accounts/logout/ajax/')
  }

  async _getHomeData({ queryHash, variables }) {
    return this.request('/graphql/query/', {
      qs: {
        query_hash: queryHash,
        variables: JSON.stringify(variables)
      }
    }).then(data => data)
  }

  async getHome(mediaItemCursor) {
    return this._getHomeData({
      queryHash: '01b3ccff4136c4adf5e67e1dd7eab68d',
      variables: {
        fetch_media_item_cursor: mediaItemCursor
      }
    })
  }

  async getUserByUsername({ username }) {
    return this.request({
      uri: `/users/web_profile_info/?username=${username}`,
      baseUrl: baseUrlApi,
      headers: {
        referer: "https://www.instagram.com" + '/' + username + '/',
        //'x-instagram-gis': ""
      }
    }).then(data => { return data.data.user; })
  }

  async getStoryReelFeed({ onlyStories = false } = {}) {
    return this.request('/graphql/query/', {
      qs: {
        query_hash: '60b755363b5c230111347a7a4e242001',
        variables: JSON.stringify({
          only_stories: onlyStories
        })
      }
    })
      .then(data => data.data.user.feed_reels_tray.edge_reels_tray_to_reel)
      .then(edge_reels_tray_to_reel => edge_reels_tray_to_reel.edges)
      .then(edges => edges.map(edge => edge.node))
  }

  async getStoryReels({
    reelIds = [],
    tagNames = [],
    locationIds = [],
    precomposedOverlay = false
  } = {}) {
    return this.request('/graphql/query/', {
      qs: {
        query_hash: '297c491471fff978fa2ab83c0673a618',
        variables: JSON.stringify({
          reel_ids: reelIds,
          tag_names: tagNames,
          location_ids: locationIds,
          precomposed_overlay: precomposedOverlay
        })
      }
    }).then(data => data.data.reels_media)
  }

  async getUserIdPhotos({ id, first = 12, after = '' } = {}) {
    return this.request('/graphql/query/', {
      qs: {
        query_hash: '6305d415e36c0a5f0abb6daba312f2dd',
        variables: JSON.stringify({
          id,
          first,
          after
        })
      }
    }).then(data => data.data)
  }

  async getPhotosByHashtag({ hashtag, first = 12, after = '' } = {}) {
    return this.request('/graphql/query/', {
      qs: {
        query_hash: 'ded47faa9a1aaded10161a2ff32abb6b',
        variables: JSON.stringify({
          tag_name: hashtag,
          first,
          after
        })
      }
    }).then(data => data.data)
  }

  async getPhotosByUsername({ username, first, after }) {
    const user = await this.getUserByUsername({ username })
    return this.getUserIdPhotos({ id: user.id, first, after })
  }

  async getStoryItemsByUsername({ username }) {
    const user = await this.getUserByUsername({ username })
    return this.getStoryItemsByReel({ reelId: user.id })
  }

  async getStoryItemsByHashtag({ hashtag }) {
    const reels = await this.getStoryReels({ tagNames: [hashtag] })
    if (reels.length === 0) return []
    return reels[0].items
  }

  async getStoryItemsByLocation({ locationId }) {
    const reels = await this.getStoryReels({ locationIds: [locationId] })
    if (reels.length === 0) return []
    return reels[0].items
  }

  async getStoryItemsByReel({ reelId }) {
    const reels = await this.getStoryReels({ reelIds: [reelId] })
    if (reels.length === 0) return []
    return reels[0].items
  }

  async markStoryItemAsSeen({
    reelMediaId,
    reelMediaOwnerId,
    reelId,
    reelMediaTakenAt,
    viewSeenAt
  }) {
    return this.request.post('/stories/reel/seen', {
      form: {
        reelMediaId,
        reelMediaOwnerId,
        reelId,
        reelMediaTakenAt,
        viewSeenAt
      }
    })
  }

  async _getFollowData({ fieldName, queryHash, variables }) {
    return this.request('/graphql/query/', {
      qs: {
        query_hash: queryHash,
        variables: JSON.stringify(variables)
      },
      baseUrl: "https://instagram.com"
    })
      .then(data => data.data.user[fieldName])
      .then(({ count, page_info, edges }) => ({
        count,
        page_info,
        data: edges.map(edge => edge.node)
      }))
  }

  async getFollowers({ userId, first = 20, after }) {
    return this._getFollowData({
      fieldName: 'edge_followed_by',
      queryHash: '37479f2b8209594dde7facb0d904896a',
      variables: {
        id: userId,
        first,
        after
      }
    })
  }

  async getFollowings({ userId, first = 20, after }) {
    return this._getFollowData({
      fieldName: 'edge_follow',
      queryHash: '58712303d941c6855d4e888c5f0cd22f',
      variables: {
        id: userId,
        first,
        after
      }
    })
  }

  async getChainsData({ userId }) {
    return this.request('/graphql/query/', {
      qs: {
        query_hash: '7c16654f22c819fb63d1183034a5162f',
        variables: JSON.stringify({
          user_id: userId,
          include_chaining: true,
          include_reel: false,
          include_suggested_users: false,
          include_logged_out_extras: false,
          include_highlight_reels: false
        })
      }
    })
      .then(data => data.data.user.edge_chaining)
      .then(({ edges }) => edges.map(edge => edge.node))
  }

  async getActivity() {
    return this.request('/accounts/activity/?__a=1').then(
      data => data.graphql.user
    )
  }

  async getProfile() {
    return this.request('/accounts/edit/?__a=1').then(data => data.form_data)
  }

  async updateProfile({
    name = '',
    email = '',
    username,
    phoneNumber = '',
    gender,
    biography = '',
    website = '',
    similarAccountSuggestions = true
  }) {
    return this.request.post('/accounts/edit/', {
      form: {
        first_name: name,
        email,
        username: username || this.credentials.username,
        phone_number: phoneNumber,
        gender,
        biography,
        external_url: website,
        chaining_enabled: similarAccountSuggestions
      }
    })
  }

  async changeProfilePhoto({ photo }) {
    return this.request.post('/accounts/web_change_profile_picture/', {
      formData: {
        profile_pic: isUrl(photo) ? request(photo) : fs.createReadStream(photo)
      }
    })
  }

  async deleteMedia({ mediaId }) {
    return this.request.post(`/create/${mediaId}/delete/`)
  }

  async _uploadPhoto({ photo }) {
    // Warning! don't change anything bellow.
    const uploadId = Date.now()

    let file

    // Needed to new method, if image is from url.
    if (isUrl(photo)) {
      // Enconding: null is required, only this way a Buffer is returned
      file = await request.get({ url: photo, encoding: null })
    } else {
      file = await fs.readFileSync(photo)
    }

    const ruploadParams = {
      media_type: 1,
      upload_id: uploadId.toString(),
      upload_media_height: 1080,
      upload_media_width: 1080,
      xsharing_user_ids: JSON.stringify([]),
      image_compression: JSON.stringify({
        lib_name: 'moz',
        lib_version: '3.1.m',
        quality: '80'
      })
    }

    //const nameEntity = `${uploadId}_0_${Math.random(1000000000, 9999999999)}`
    const nameEntity = `${Math.random(1000000000, 9999999999)}`

    const headersPhoto = {
      'x-entity-type': 'image/jpeg',
      "User-Agent": userAgent,
      "Connection": "keep-alive",
      offset: 0,
      'x-entity-name': nameEntity,
      'x-instagram-rupload-params': JSON.stringify(ruploadParams),
      'x-entity-length': file.byteLength,
      'Content-Length': file.byteLength,
      'Content-Type': 'application/octet-stream',
      'x-ig-app-id': `1217981644879628`,
      'Accept-Encoding': 'gzip',
      /*
      'X-Pigeon-Rawclienttime': (Date.now() / 1000).toFixed(3),
      'X-IG-Connection-Speed': `${Math.random(1000, 3700)}kbps`,
      'X-IG-Bandwidth-Speed-KBPS': '-1.000',
      'X-IG-Bandwidth-TotalBytes-B': '0',
      'X-IG-Bandwidth-TotalTime-MS': '0',
      */
      "Origin": "https://www.instagram.com",
      Referer: "https://www.instagram.com/",
      "X-IG-App-ID": 1217981644879628,
      "X-ASBD-ID": 198387,
    }

    //console.log("request: " + JSON.stringify(this.request.get("", headersPhoto)));

    // Json = false, must be important to post work!
    let responseUpload = await this.request({
      uri: `https://i.instagram.com/rupload_igphoto/fb_uploader_${nameEntity}`,
      //uri: `/media/configure/`,
      baseUrl: "",
      headers: headersPhoto,
      method: 'POST',
      json: false,
      //gzip: true,
      //followAllRedirects: true, //prevent 302 error
      body: file,
      /*
      form: {
        source_type: "library",
        upload_id: uploadId,
        disable_comments: 0,
        like_and_view_counts_disabled: 0,
        igtv_share_preview_to_feed: 1,
        is_unified_video: 1,
        video_subtitles_enabled: 0
      }
      */
    })

    try {
      console.log("responseUpload: \n" + responseUpload);

      responseUpload = JSON.parse(responseUpload)

      if ('upload_id' in responseUpload) return responseUpload

      throw new Error('Image upload error')
    } catch (e) {
      throw new Error(`Image upload error: ${e}`)
    }
  }

  // Upload to story moved to uploadPhoto
  // Post: 'feed' or 'story'
  async uploadPhoto({ photo, caption = '', post = 'feed' }) {
    const dateObj = new Date()
    const now = dateObj
      .toISOString()
      .replace(/T/, ' ')
      .replace(/\..+/, ' ')
    const offset = dateObj.getTimezoneOffset()

    const responseUpload = await this._uploadPhoto({ photo })

    return this.request
      .post(
        //`/create/${post === 'feed' ? 'configure/' : 'configure_to_story/'}`,
        `/media/${post === 'feed' ? 'configure/' : 'configure_to_story/'}`,
        {
          form: {
            upload_id: responseUpload.upload_id,
            caption,
            timezone_offset: offset,
            date_time_original: now,
            date_time_digitalized: now,
            source_type: '4',
            edits: {
              crop_original_size: [1080, 1080],
              crop_center: [0.0, -0.0],
              crop_zoom: 1.0
            }
          },
          baseUrl: baseUrlApi
        }
      )
      .then(response => response)
  }

  async getMediaFeedByLocation({ locationId }) {
    return this.request(`/explore/locations/${locationId}/?__a=1`).then(
      data => data.graphql.location
    )
  }

  async getMediaFeedByHashtag({ hashtag }) {
    return this.request(`/explore/tags/${hashtag}/?__a=1`).then(
      data => data.graphql.hashtag
    )
  }

  async locationSearch({ query, latitude, longitude, distance = 500 }) {
    return this.request('/location_search/', {
      qs: { search_query: query, latitude, longitude, distance }
    }).then(data => data.venues)
  }

  async getMediaByShortcode({ shortcode }) {
    return this.request(`/p/${shortcode}/?__a=1`).then(
      data => data.graphql.shortcode_media
    )
  }

  async getMediaComments({ shortcode, first = 12, after = '' }) {
    return this.request('/graphql/query/', {
      qs: {
        query_hash: 'bc3296d1ce80a24b1b6e40b1e72903f5',
        variables: JSON.stringify({ shortcode, first, after })
      }
    })
      .then(response => response.data.shortcode_media || {})
      .then(media => media.edge_media_to_parent_comment || {})
      .then(({ count = 0, page_info = {}, edges = [] }) => ({
        count,
        page_info,
        edges
      }))
  }

  async getMediaLikes({ shortcode, first = 12, after = '' }) {
    return this.request('/graphql/query/', {
      qs: {
        query_hash: 'd5d763b1e2acf209d62d22d184488e57',
        variables: JSON.stringify({
          shortcode,
          first,
          after
        })
      }
    })
      .then(response => response.data.shortcode_media || {})
      .then(media => media.edge_liked_by || {})
      .then(({ count = 0, page_info = {}, edges = [] }) => ({
        count,
        page_info,
        edges
      }))
  }

  async addComment({ mediaId, text, replyToCommentId }) {
    return this.request.post(`/web/comments/${mediaId}/add/`, {
      form: { comment_text: text, replied_to_comment_id: replyToCommentId }, baseUrl: baseUrlApi
    })
  }

  async deleteComment({ mediaId, commentId }) {
    return this.request.post(`/web/comments/${mediaId}/delete/${commentId}/`, { baseUrl: baseUrlApi })
  }

  async getChallenge({ challengeUrl }) {
    return this.request(`${challengeUrl}?__a=1`)
  }

  async _navigateChallenge({ challengeUrl, endpoint, form }) {
    const url = endpoint
      ? challengeUrl.replace('/challenge/', `/challenge/${endpoint}/`)
      : challengeUrl
    return this.request.post(url, {
      headers: {
        Referer: `${baseUrl}${challengeUrl}`
      },
      form
    })
  }

  async updateChallenge({ challengeUrl, choice, securityCode }) {
    const form = securityCode ? { security_code: securityCode } : { choice }

    return this._navigateChallenge({
      challengeUrl,
      form
    })
  }

  async resetChallenge({ challengeUrl }) {
    return this._navigateChallenge({
      challengeUrl,
      endpoint: 'reset'
    })
  }

  async replayChallenge({ challengeUrl }) {
    return this._navigateChallenge({
      challengeUrl,
      endpoint: 'replay'
    })
  }

  async approve({ userId }) {
    return this.request.post(`/web/friendships/${userId}/approve/`, { baseUrl: baseUrlApi })
  }

  async ignore({ userId }) {
    return this.request.post(`/web/friendships/${userId}/ignore/`, { baseUrl: baseUrlApi })
  }

  async follow({ userId }) {
    return this.request.post(`/web/friendships/${userId}/follow/`, { baseUrl: baseUrlApi })
  }

  async unfollow({ userId }) {
    return this.request.post(`/web/friendships/${userId}/unfollow/`, { baseUrl: baseUrlApi })
  }

  async block({ userId }) {
    return this.request.post(`/web/friendships/${userId}/block/`, { baseUrl: baseUrlApi })
  }

  async unblock({ userId }) {
    return this.request.post(`/web/friendships/${userId}/unblock/`, { baseUrl: baseUrlApi })
  }

  async like({ mediaId }) {
    return this.request.post(`/web/likes/${mediaId}/like/`, { baseUrl: baseUrlApi })
  }

  async unlike({ mediaId }) {
    return this.request.post(`/web/likes/${mediaId}/unlike/`, { baseUrl: baseUrlApi })
  }

  async save({ mediaId }) {
    return this.request.post(`/web/save/${mediaId}/save/`, { baseUrl: baseUrlApi })
  }

  async unsave({ mediaId }) {
    return this.request.post(`/web/save/${mediaId}/unsave/`, { baseUrl: baseUrlApi })
  }

  async search({ query, context = 'blended' }) {
    return this.request('/web/search/topsearch/', { qs: { query, context }, baseUrl: baseUrlApi })
  }

  async _getPosts({ userId, perPage = 12, nextPageToken }) {
    const variables = JSON.stringify({
      id: userId,
      first: perPage,
      after: nextPageToken
    })
    const options = {
      qs: {
        query_hash: '42323d64886122307be10013ad2dcc44',
        variables
      }
    }

    return this.request
      .get('/graphql/query/', options)
      .then(response => response.data.user)
  }

  async getPrivateProfilesFollowRequests(cursor) {
    const cursorParam = cursor ? `&cursor=${cursor}` : ''
    return this.request(
      `accounts/access_tool/current_follow_requests?__a=1${cursorParam}`
    )
  }

}

function getNewSessionId() {
  
  //example targets, these were generated irl on instagram.com (edited)
  //55978339344:R5OEhF8g8zzm82:1:AYf6yokMGhjiRy1W2ck539P4A4ez7jhNjBBmAymlPQ
  //55978339344:zWJnev24D1hGH9:19:AYcpm-ycw5SDS_iXXdE-DgT_pjkid5qFb8VPon-wGw
  //55978339344:AGNs341liFKle1:19:AYceaPfX5kdfKAvj0J3Z3S0RkoU1Zu7i-xru5sNpXw
  //55978339344:0M9s13gBuJiwC0:19:AYdHc7AHYXNtz3JoGmWjYzSnVeUlXqk1kQwPYZcn6g;
  
  //doesn't work, but this might be close
  //see https://static.cdninstagram.com/rsrc.php/v3iF2k4/y-/l/en_US/dY3zq_4wAbs.js?_nc_x=Ij3Wp8lg5Kz
  //it has a function getSessionId that returns:  `this.getTabId() + ":" + this.getPageId() + ":" + this.getTransitionId() + "-" + this.getActivityId()`
  
  //return "55978339344" + ":" + generateString(14) + ":19:AY" + generateString(40);

  return sessionid;

}

function generateString(length) {
  const characters ='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  let result = ' ';
  const charactersLength = characters.length;
  for ( let i = 0; i < length; i++ ) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }

  return result;
}

module.exports = Instagram
