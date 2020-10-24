'use strict'

const yaml = require('js-yaml')
const fs = require('fs')
const axios = require('axios')
const shell = require('shelljs')
const path = require('path')
const async = require('async')
let table = require('text-table')
let asTable = require ('as-table')
let inquirer = require('inquirer')
let randomstring = require ('randomstring')
const compressing = require('compressing')
const cliProgress = require('cli-progress')
const { Command } = require('commander')
let glob = require("glob")
let progress = require('progress-stream')
const PROGRAM_NAME = 'pwm'
let CFG = {}

const program = new Command()
let currentProfile = null
/**
* TODOS

- history 
- scheduling strategy
- auto clean exited wk
- labels node
- modificators
- logs
- scheduler a frequenza variabile
- multi api
- check limits on storage and resources
- node auto update fatto bene
- limiti utenti -> crediti
- upload multifile, not batch
- gpu selectors by mem gpu
- login to private registry -> Secrets

- schedule on cpu e gpu with "now" lastSeen

*/

program.version(require('./version'), '-v, --vers', '')

let DEFAULT_API_VERSION = 'v1'
let BATCH_LIMIT = 10

const RESOURCE_ALIAS = {
	wk: 		 'Workload',
	workload: 	 'Workload',
	gpu: 	     'GPU',
	gpus: 	     'GPU',
	cpu: 	     'CPU',
	cpus: 	     'CPU',
	node: 	     'Node',
	nodes: 	     'Node',
	group: 	     'Group',
	groups:      'Group',
	user: 	     'User',
	users:       'User',
	volume:      'Volume',
	volumes:     'Volume',
	vol:    	 'Volume',
	vols:        'Volume',
	storage: 	 'Storage',
	storages: 	 'Storage',
}

function errorLog(string) {
	console.log('\x1b[33m%s\x1b[0m', string)
}

function alias (resource) {
	if (RESOURCE_ALIAS[resource] !== undefined) {
		return RESOURCE_ALIAS[resource]
	} 
	return resource
}

function webSocketForApiServer () {
	if ((CFG.api[CFG.profile].server[0]).split('https://').length == 2) {
		return 'wss://' + (CFG.api[CFG.profile].server[0]).split('https://')[1]
	} else {
		return 'ws://' + (CFG.api[CFG.profile].server[0]).split('http://')[1]
	}
}

/**
*	Get user home dir,
*	read conf file if present
*/
const homedir = require('os').homedir()
try {
	CFG = yaml.safeLoad(fs.readFileSync(homedir + '/.' + PROGRAM_NAME + '/config', 'utf8'))
	currentProfile = CFG.profile
} catch (err) {
	errorLog('You must create the configuration file @', homedir + '/.' + PROGRAM_NAME + '/config')
	//process.exit()
}

function formatResource (inData) {
	if (inData instanceof Array) {
		return inData
	}  else {
		return [inData]
	}
}

function compatibilityRequest (cb) {
	try {
		axios.defaults.headers.common = {'Authorization': `Bearer ${CFG.api[CFG.profile].auth.token}`}
		axios['post'](`${CFG.api[CFG.profile].server[0]}/${DEFAULT_API_VERSION}/api/cli/compatibility`, 
			{data: {cliVersion: require('./version')},
			}, {timeout: 1000}).then((res) => {
			cb(res.data.compatible)
		}).catch((err) => {
			if (err.code == 'ECONNREFUSED') {
				errorLog('Error connecting to API server ' + CFG.api[CFG.profile].server[0])
			} else {
				if (err.response !== undefined && err.response.statusText !== undefined) {
					errorLog('Error in response from API server: ' + err.response.statusText) 	
				} else {
					errorLog('Error in response from API server: Unknown') 	
				}
			}
			cb(false)
		}) 	  		
	} catch (err) {errorLog(err)}
}


function apiRequest (type, resource, verb, cb) {
	let body, query = null
	if (type == 'get') {
		query = resource
	} else {
		body = resource
	}
	try {
		axios.defaults.headers.common = {'Authorization': `Bearer ${CFG.api[CFG.profile].auth.token}`}
		axios[type](`${CFG.api[CFG.profile].server[0]}/${resource.apiVersion}/${resource.kind}/${verb}`, 
			{data: body,
			}, query, {timeout: 1000}).then((res) => {
			cb(res.data)
		}).catch((err) => {
			if (err.code == 'ECONNREFUSED') {
				errorLog('Error connecting to API server ' + CFG.api[CFG.profile].server[0])
			} else {
				if (err.response !== undefined && err.response.statusText !== undefined) {
					errorLog('Error in response from API server: ' + err.response.statusText) 	
				} else {
					errorLog('Error in response from API server: Unknown') 	
				}
			}
		}) 	  		
	} catch (err) {}
}

function batchApiRequest (type, resource, verb, cb) {
	let body, query = null
	if (type == 'get') {
		query = resource
	} else {
		body = resource
	}
	try {
		axios.defaults.headers.common = {'Authorization': `Bearer ${CFG.api[CFG.profile].auth.token}`}
		axios[type](`${CFG.api[CFG.profile].server[0]}/${DEFAULT_API_VERSION}/batch/${verb}`, 
			{data: body,
			}, query, {timeout: 5000}).then((res) => {
			cb(res.data)
		}).catch((err) => {
			if (err.code == 'ECONNREFUSED') {
				errorLog('Error connecting to API server' + CFG.api[CFG.profile].server[0])
			} else {
				errorLog('Error in response from API server') 
			}
		}) 	  		
	} catch (err) {}
}

program.command('api-version')
.description('api info')
.action((cmdObj) => {
	apiRequest('post',  {apiVersion: 'v1', kind: 'api'}, 'version', (res) => {console.log(res)})
})

program.command('use <profile>')
.description('set the api profile to use')
.action((profile) => {
  	CFG.profile = profile 
  	try {
  		let newCFG = yaml.safeDump(CFG) 
  		fs.writeFile(homedir + '/.' + PROGRAM_NAME + '/config', newCFG, 'utf8', (err) => {
  			if (err) {
  				errorLog(err)
  			} else {
  				console.log('Now using profile', '*' + profile + '*')
  			}
  		})
   	} catch (err) {
   		errorLog(err)
   	}
})

program.command('profile <cmd> [profile]')
.option('-t, --token <token>', 'Token')
.option('-s, --api-server <apiServer>', 'Api Server')
.description('set the api profile to use')
.action((cmd, profile, cmdObj) => {
	switch (cmd) {
		case 'use':
  			CFG.profile = profile 
  			try {
  				let newCFG = yaml.safeDump(CFG) 
  				fs.writeFile(homedir + '/.' + PROGRAM_NAME + '/config', newCFG, 'utf8', (err) => {
  					if (err) {
  						errorLog(err)
  					} else {
  						console.log('Now using profile', '*' + profile + '*')
  					}
  				})
   			} catch (err) {
   				errorLog(err)
   			}
   			break

   		case 'init':
			fs.mkdir(homedir + '/.' + PROGRAM_NAME, { recursive: true }, (err) => {
			  	if (err) throw err
			  	let jsonConfig = {}
			  	jsonConfig.profile = profile
			  	jsonConfig.api = {}
			  	jsonConfig.api[profile] = {
			  		server: [cmdObj.apiServer],
			  		auth: {
			  			token: cmdObj.token
			  		}
			  	}
  				fs.writeFile(homedir + '/.' + PROGRAM_NAME + '/config', yaml.safeDump(jsonConfig) , 'utf8', (err) => {
  					if (err) {
  						errorLog(err)
  					} else {
  						console.log('Init profile', '*' + profile + '* done')
  					}
  				})
			})
			break

   		case 'add':
			fs.mkdir(homedir + '/.' + PROGRAM_NAME, { recursive: true }, (err) => {
			  	if (err) throw err
			  	let jsonConfig = CFG
			  	jsonConfig.api[profile] = {
			  		server: [cmdObj.apiServer],
			  		auth: {
			  			token: cmdObj.token
			  		}
			  	}
  				fs.writeFile(homedir + '/.' + PROGRAM_NAME + '/config', yaml.safeDump(jsonConfig) , 'utf8', (err) => {
  					if (err) {
  						errorLog(err)
  					} else {
  						console.log('Added profile', '*' + profile + '*')
  					}
  				})
			})
			break

		case 'del':
			fs.mkdir(homedir + '/.' + PROGRAM_NAME, { recursive: true }, (err) => {
			  	if (err) throw err
			  	let jsonConfig = CFG
			  	delete jsonConfig.api[profile]
  				fs.writeFile(homedir + '/.' + PROGRAM_NAME + '/config', yaml.safeDump(jsonConfig) , 'utf8', (err) => {
  					if (err) {
  						errorLog(err)
  					} else {
  						console.log('Deleted profile', '*' + profile + '*')
  					}
  				})
			})
			break

		case 'using':
			console.log('You are on', '*' + CFG.profile + '*', 'profile') 
	}

})

program.command('using')
.description('get setted profile')
.action((profile) => {
  	console.log('You are on', '*' + CFG.profile + '*', 'profile') 
})

program.command('status')
.description('control plane status')
.action((cmdObj) => {
	apiRequest('post',  {apiVersion: 'v1', kind: 'cluster', metadata: {group: 'pwm.all'}}, 'status', (res) => {console.log(res)})
})

program.command('apply')
.option('-f, --file <file>', 'File to apply')
.option('-g, --group <group>', 'Group')
.option('--v, --verbose', 'Verbose')
.description('apply')
.action((cmdObj) => {
	try {
	  	const doc = yaml.safeLoadAll(fs.readFileSync(cmdObj.file, 'utf8'))
	  	doc.forEach((singleDoc) => { 
	  		if (cmdObj.group !== undefined && singleDoc.metadata.group == undefined) {
	  			singleDoc.metadata.group = cmdObj.group 
	  		}
	  	})
	  	if (doc.length > BATCH_LIMIT) {
	  		batchApiRequest('post', doc, 'apply', (res) => {console.log(res)})
	  	} else {
	  		formatResource(doc).forEach((resource) => {
	  			apiRequest('post', resource, 'apply', (res) => {console.log(res)})
	  		})
	  	}
	} catch (e) {
	  errorLog(e)
	}
})

program.command('delete [resource] [name]')
.option('-f, --file <file>', 'File to apply')
.option('-g, --group <group>', 'Group')
.option('--v, --verbose', 'Verbose')
.description('apply')
.action((resource, name, cmdObj) => {
	try {
		if (cmdObj.file !== undefined) {
	  		const doc = yaml.safeLoadAll(fs.readFileSync(cmdObj.file, 'utf8'))
	  		doc.forEach((singleDoc) => { 
	  			if (cmdObj.group !== undefined) {
	  				singleDoc.metadata.group = cmdObj.group 
	  			}
	  		})
	  		if (doc.length > BATCH_LIMIT) {
	  			batchApiRequest('post', doc, 'delete', (res) => {console.log(res)})
	  		} else {
	  			formatResource(doc).forEach((resource) => {
	  				apiRequest('post', resource, 'delete', (res) => {console.log(res)})
	  			})
	  		}
	  	} else {
	  		if (resource == undefined || name == undefined) {
	  			console.log('You must specify a resource kind and name')
	  			process.exit()
	  		}
			resource = alias(resource)
			apiRequest('post', {kind: resource, apiVersion: DEFAULT_API_VERSION, metadata: {name: name, group: cmdObj.group}, force: cmdObj.force}, 
					'delete', (res) => {console.log(res)})
	  	}
	} catch (e) {
	  errorLog(e)
	}
})

program.command('stop [resource] [name]')
.option('-f, --file <file>', 'File to apply')
.option('-g, --group <group>', 'Group')
.option('--v, --verbose', 'Verbose')
.description('apply')
.action((resource, name, cmdObj) => {
	try {
		if (cmdObj.file !== undefined) {
	  		const doc = yaml.safeLoadAll(fs.readFileSync(cmdObj.file, 'utf8'))
	  		doc.forEach((singleDoc) => { 
	  			if (cmdObj.group !== undefined) {
	  				singleDoc.metadata.group = cmdObj.group 
	  			}
	  		})
	  		if (doc.length > BATCH_LIMIT) {
	  			batchApiRequest('post', doc, 'cancel', (res) => {console.log(res)})
	  		} else {
	  			formatResource(doc).forEach((resource) => {
	  				apiRequest('post', resource, 'cancel', (res) => {console.log(res)})
	  			})
	  		}
	  	} else {
	  		if (resource == undefined || name == undefined) {
	  			console.log('You must specify a resource kind and name')
	  			process.exit()
	  		}
			resource = alias(resource)
			apiRequest('post', {kind: resource, apiVersion: DEFAULT_API_VERSION, metadata: {name: name, group: cmdObj.group}}, 
					'cancel', (res) => {console.log(res)})
	  	}
	} catch (e) {
	  errorLog(e)
	}
})

program.command('get <resource> [name]')
.option('-g, --group <group>', 'Group')
.option('-j, --json', 'JSON output')
.option('-w, --watch', 'Watch')
.description('Get resource')
.action((resource, name, cmdObj) => {
	resource = alias(resource)
	if (name == undefined) {
		let fn = () => {apiRequest('post', {kind: resource, apiVersion: DEFAULT_API_VERSION, metadata: {group: cmdObj.group}}, 
			'get', (res) => {
				if (!cmdObj.json) {
					console.log(asTable(res))
				} else {
					console.log(res)
				}
		})}
		if (cmdObj.watch) {
			console.clear()
			fn()
			setInterval (() => {
				console.clear()
				fn()
			}, 2000)
		} else {
			fn ()
		}
	} else {
		apiRequest('post', {kind: resource, apiVersion: DEFAULT_API_VERSION, metadata: {name: name, group: cmdObj.group}}, 
			'getOne', (res) => {
				if (!cmdObj.json) {
					console.log(asTable([res]))
				} else {
					console.log(res)
				}
			})
	}	
})

program.command('logs <resource> <name>')
.option('-g, --group <group>', 'Group')
.description('Logs for resource')
.action((resource, name, cmdObj) => {
	resource = alias(resource)
	apiRequest('post', {kind: resource, apiVersion: DEFAULT_API_VERSION, metadata: {name: name, group: cmdObj.group}}, 
	'getOne', (resResource) => {
		apiRequest('post', {kind: resource, apiVersion: DEFAULT_API_VERSION, name: name, nodename: resResource.node, id: resResource.c_id}, 
		'logs', (res) => {
			console.log(res)	
		})
	})
})

program.command('describe <resource> <name>')
.option('-g, --group <group>', 'Group')
.option('-t, --table', 'Table output')
.description('Get resource')
.action((resource, name, cmdObj) => {
	resource = alias(resource)
	if (name == undefined) {
		let fn = () => {apiRequest('post', {kind: resource, apiVersion: DEFAULT_API_VERSION}, 
			'get', (res) => {
				if (!cmdObj.json) {
					console.log(asTable(res))
				} else {
					console.log(res)
				}
		})}
		if (cmdObj.watch) {
			console.clear()
			fn()
			setInterval (() => {
				console.clear()
				fn()
			}, 2000)
		} else {
			fn ()
		}
	} else {
		apiRequest('post', {kind: resource, apiVersion: DEFAULT_API_VERSION, metadata: {name: name, group: cmdObj.group}}, 
			'describe', (res) => {
				if (cmdObj.table) {
					console.log(asTable([res]))
				} else {
					console.log(res)
				}
			})
	}	
})

program.command('drain <resource> <nodename>')
.option('-g, --group <group>', 'Group')
.description('drain a node')
.action((resource, nodename, cmdObj) => {
	resource = alias(resource)
	apiRequest('post', {kind: resource, apiVersion: DEFAULT_API_VERSION, metadata: {name: nodename, group: cmdObj.group}}, 
			'drain', (res) => {console.log(res)})
})

/**
*	Copy
*/
program.command('cp <src> <dst>')
.option('-g, --group <group>', 'Group')
.description('copy dir from local to volume folder')
.action(async (src, dst, cmdObj) => {
	let tmp = require('os').tmpdir()
	const bar1 = new cliProgress.SingleBar({
		format: 'Copy |' + '{bar}' + '| {percentage}% || {phase}',
		}, cliProgress.Presets.shades_classic)
	bar1.start(120, 0, {
		phase: 'Compressing'
	})
	let archieveName = tmp + '/pwm-vol-' + randomstring.generate(12)
	//let node = dst.split(':')[0]
	let dstName = dst
	bar1.update(5, {phase: 'Compressing'})
	await compressing.tar.compressDir(src, archieveName)
	bar1.update(5, {phase: 'Sending'})
	bar1.update(10)
	const size = fs.statSync(archieveName)
	var str = progress({
	    length: size.size,
	    time: 10 /* ms */
	})
	 
	str.on('progress', function(progress) {
	    bar1.update(10 + progress.percentage)
	    if (progress.percentage == 100) {
	    	bar1.update(120, {phase: 'Transferring to container volume'})
	    }
	})

	axios({
	  method: 'POST',
	  url: `${CFG.api[CFG.profile].server[0]}/${DEFAULT_API_VERSION}/user/defaultgroup`,
	  headers: {
	    'Authorization': `Bearer ${CFG.api[CFG.profile].auth.token}`
	  }
	}).then(async (resGroup) => {
		axios({
		  method: 'POST',
		  url: `${CFG.api[CFG.profile].server[0]}/${DEFAULT_API_VERSION}/volume/upload/pwm.${cmdObj.group || resGroup.data.group}.${dstName}`,
		  maxContentLength: Infinity,
		  maxBodyLength: Infinity,
		  headers: {
		    'Content-Type': 'multipart/form-data',
		    'Content-Length': size.size,
		    'Authorization': `Bearer ${CFG.api[CFG.profile].auth.token}`
		  },
		  data: fs.createReadStream(archieveName).pipe(str)
		}).then((res) => {
			fs.unlink(archieveName, () => {})
			bar1.update(120, {phase: 'Completed'})
			bar1.stop()
		})
	})
})

program.command('cpn <src> <dst>')
.option('-g, --group <group>', 'Group')
.description('copy dir from local to volume folder')
.action(async (src, dst, cmdObj) => {
	const bar1 = new cliProgress.SingleBar({
	format: 'Copy |' + '{bar}' + '| {percentage}% || {phase}',
	}, cliProgress.Presets.shades_classic)
	let getDirectories = function (src, callback) {
	  glob(src + '/**/*', callback);
	};
	getDirectories(src, function (err, res) {
	  if (err) {
	    console.log('Error', err);
	  } else {
	    console.log(res.length)
	    copy(res)
	  }
	})
	let copy = async function (ary) {
		bar1.start(ary.length, 0, {
			phase: 'Sending'
		})
		let dstName = dst
		
		var str = progress({
		    length: ary.length,
		    time: 10 /* ms */
		})
		 
		str.on('progress', function(progress) {
		    bar1.update(progress.percentage)
		    if (progress.percentage == ary.length) {
		    	bar1.update(ary.length + 100, {phase: 'Transferring to container volume'})
		    }
		})
		let onlyFiles = []
		ary.forEach((file) => {
			const size = fs.statSync(file)
			if (!size.isDirectory()) {
				onlyFiles.push(file)
			}
		})
		let queue = []
		onlyFiles.forEach((file) => {
			queue.push((cb) => {
				console.log(file)
				const size = fs.statSync(file)
				axios({
				  method: 'POST',
				  url: `${CFG.api[CFG.profile].server[0]}/${DEFAULT_API_VERSION}/user/defaultgroup`,
				  headers: {
				    'Authorization': `Bearer ${CFG.api[CFG.profile].auth.token}`
				  }
				}).then(async (resGroup) => {
					axios({
					  method: 'POST',
					  url: `${CFG.api[CFG.profile].server[0]}/${DEFAULT_API_VERSION}/volume/upload/single/pwm.${cmdObj.group || resGroup.data.group}.${dstName}`,
					  maxContentLength: Infinity,
					  maxBodyLength: Infinity,
					  headers: {
					    'Content-Type': 'multipart/form-data',
					    'Content-Length': size.size,
					    'Authorization': `Bearer ${CFG.api[CFG.profile].auth.token}`
					  },
					  data: fs.createReadStream(file).pipe(str)
					}).then((res) => {
						console.log('transferred', file)
						cb(null)
					}).catch((err) => {
						cb(true)
					})
				})
			})
		})
		async.series(queue)
	}
})

/**
*	Download
*/
program.command('download <dst> <src>')
.option('-g, --group <group>', 'Group')
.description('copy dir from remote volumes to local folder. <dst> is local path, <src> is volumeName')
.action(async (dst, src, cmdObj) => {
	let tmp = require('os').tmpdir()
	let archieveName = tmp + '/pwm-vol-' + randomstring.generate(12)
	
	let dstName = dst
	axios({
	  method: 'POST',
	  url: `${CFG.api[CFG.profile].server[0]}/${DEFAULT_API_VERSION}/user/defaultgroup`,
	  headers: {
	    'Authorization': `Bearer ${CFG.api[CFG.profile].auth.token}`
	  }
	}).then(async (resGroup) => {
		axios({
		  method: 'POST',
		  url: `${CFG.api[CFG.profile].server[0]}/${DEFAULT_API_VERSION}/volume/download/pwm.${cmdObj.group || resGroup.data.group}.${dstName}`,
		  responseType: 'stream',
		  headers: {
		    'Authorization': `Bearer ${CFG.api[CFG.profile].auth.token}`
		  }
		}).then(async (res) => {
			fs.mkdir(src, { recursive: true }, (err) => {
				let writeStream = fs.createWriteStream(path.join(src + '.compressed'))
				res.data.pipe(writeStream)
    	  		let error = null;
    	  		writeStream.on('error', err => {
    	  		  	error = err;
    	  		  	console.log(error)
    	  		  	writeStream.close()
    	  		})
    	  		writeStream.on('close', async () => {
    	  		  if (!error) {
    	  		    await compressing.tar.uncompress(path.join(src + '.compressed'), path.join(src))
    	  		    fs.unlink(path.join(src + '.compressed'), () => {})
    	  		    console.log('Done')
    	  		  }
    	  		})
    	  	})
		})
	})
})

/**
*	Shell
*/
program.command('shell <resource> <containername>')
.option('-g, --group <group>', 'Group')
.action((resource, containername, cmdObj) => {
	var DockerClient = require('./src/web-socket-docker-client')
	function main (containerId, nodeName, authToken) {
	  	var client = new DockerClient({
	  	  	url: webSocketForApiServer() + '/pwm/cshell',
	  	  	tty: true,
	  	  	command: 'bash',
	  	  	container: containerId,
	  	  	node: nodeName,
	  	  	token: authToken
	  	})
	  	return client.execute().then(() => {
    		// magic trick
    		process.stdin.setRawMode(true)
	  	  	process.stdin.pipe(client.stdin)
	  	  	client.stdout.pipe(process.stdout)
	  	  	client.stderr.pipe(process.stderr)
	  	  	client.on('exit', (code) => {
	  	  	  	process.exit(code)
	  	  	})
	  	  	client.resize(process.stdout.rows, process.stdout.columns)
	  	  	process.stdout.on('resize', () => {
	  	  	  	client.resize(process.stdout.rows, process.stdout.columns)
	  	  	})
	  	})
	}
	resource = alias(resource)
	apiRequest('post', {kind: resource, apiVersion: DEFAULT_API_VERSION, metadata: {name: containername, group: cmdObj.group}}, 
		'getOne', (res) => {
			console.log(res)
		apiRequest('post', {kind: 'authtoken', apiVersion: DEFAULT_API_VERSION, metadata: {}}, 
			'get', (resAuth) => {
			if (res) {
				console.log('Waiting connection...')
				try {
					main(res.c_id, res.node, resAuth)	
				} catch (err) {}
			}
		})
	})

})

/**
*	Interactive mode
*/
program.command('it <procedure>')
.description('Interactive mode')
.action(async (procedure) => {
	apiRequest('post', {
		apiVersion: 'v1',
		kind: 'interactive',
		name: procedure
	}, 'get', async (res) => {
		if (res.nopipe != undefined && res.nopipe == true) {
			console.log('No procedure named', procedure)
			process.exit()
		}
		let toReturn = ''
		let goOn = true
		let fn = res[0]
		let key = fn.key
		let responses = {}
		while (goOn) {
			let res = await inquirer.prompt(fn)
			axios.defaults.headers.common = {'Authorization': `Bearer ${CFG.api[CFG.profile].auth.token}`}
			let response = await axios['post'](`${CFG.api[CFG.profile].server[0]}/v1/interactive/next`, 
				{data: {name: procedure, key: key, res: Object.values(res)[0]},
				}, null, {timeout: 1000})
			
			responses[Object.keys(res)[0]] = Object.values(res)[0]
			if (response.data == '' || response.data == undefined || response.data[0] == undefined) {
				goOn = false
				apiRequest('post', {
					apiVersion: DEFAULT_API_VERSION,
					kind: 'interactive',
					name: procedure,
					responses: responses,
				}, 'apply', (res) => {
					apiRequest('post', res, 'apply',  (resApply) => {
						console.log(resApply)
					})
				})
			} else {
				fn = response.data[0]
				key = fn.key
			}
		}
	})
})

compatibilityRequest((data) => {
	if (data == false) {
		errorLog('Incompatible cli version with api version. Update the cli')
	}
	program.parse(process.argv)
})